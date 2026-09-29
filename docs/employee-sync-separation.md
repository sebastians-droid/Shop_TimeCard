# Employee Sync Separation — Handoff Brief

**Status:** Not started. Investigation complete, root cause confirmed.
**Symptom:** The ComputerEase Excel → Dataverse employee sync never runs in production. No errors, no logs, silent no-op.

---

## 1. Root cause (confirmed)

The sync is implemented as an **Azure Functions timer trigger**, but this project deploys its API as **Azure Static Web Apps managed functions**, which support **HTTP triggers only**. A timer trigger cannot run under the current deployment, and SWA rejects a function app that registers any non-HTTP trigger:

> The managed function apps in Static Web Apps are optimized for API scenarios and support only HTTP triggers. If you need to use other trigger types supported by Azure Functions such as for cron jobs [...] you can use the bring your own Functions app feature.
> — [Azure SWA FAQ](https://learn.microsoft.com/en-us/azure/static-web-apps/faq)

Deployment is pinned to managed functions here:

```yaml
# .github/workflows/azure-static-web-apps-ambitious-bay-0f6873a0f.yml
api_location: "api"     # non-empty => SWA managed functions
```

There was also a **second, independent bug** masking the first: `api/src/index.js` never imported the timer file, so the trigger was never even registered. Fixing that import alone would *not* have made the sync run — it would have surfaced the SWA restriction instead.

**Conclusion: this cannot be fixed in place. The sync must move out of the Static Web App.** The original instinct to make it a separate thing was correct; Azure enforces it.

---

## 2. What was already changed (and what was deliberately left alone)

| File | Change | Why |
|---|---|---|
| `api/src/functions/api.js` | **Added** `app.http('employeeSyncManual', { route: 'employee-sync', methods: ['POST'] })` | `POST /api/employee-sync` was routed in `handlers.js` but had no Azure registration, so it 404'd in production while working locally. Named `employeeSyncManual` because Azure requires unique function names and `employeeSync` is taken by the timer. This is HTTP, so it is valid under SWA. **Keep this.** |
| `api/src/index.js` | **Left importing only `./functions/api`**, with a comment explaining why | Importing the timer file would register a non-HTTP trigger and risk breaking the SWA deploy for no benefit. |
| `api/src/functions/employee-sync.js` | **Untouched, currently dead** | Retained as the timer definition to move into the new Function App. |

Verified: the function app currently registers 11 HTTP triggers and zero non-HTTP triggers.

---

## 3. Code inventory

### The sync itself
- **`api/shared/employee-sync.js`** (~304 lines) — the whole sync. Exports only `runSync({ excelPath, excelBuffer })`.
  - Reads the workbook from SharePoint via Microsoft Graph (`readExcelFromSharePoint`), or from a local path / buffer if provided.
  - Requires a worksheet whose name contains `premployee`.
  - `parseExcelRow` maps fixed columns 1–12 (empNum, name, address1-3, phone, department, unionName, unionLocal, className, exportId). Column 8 is skipped.
  - `DEPT_LABEL_TO_VALUE` hardcodes 20 department label → Dataverse option-set values.
  - Resolves `swank_unions` and `swank_classes` to GUIDs, then creates/updates/deactivates rows in **`swank_employees`**.
  - Returns `{ created, updated, deactivated, unchanged, log }`.
- **`api/src/functions/employee-sync.js`** — timer wrapper. Schedule `0 0 5,13 * * *` (05:00 and 13:00 **UTC** daily). Currently not imported anywhere.
- **`api/shared/handlers.js:194-198`** — `POST /api/employee-sync`, gated by `requireManager`, calls `runSync({ excelPath: process.env.SYNC_EXCEL_PATH })`.

### Important: two different Dataverse tables
This is the strongest argument that the sync is a separate domain from the timecard app.

| Table | Written by | Purpose |
|---|---|---|
| `swank_employees` | **the sync only** | Master employee roster from ComputerEase |
| `swank_shopemployees` | the timecard app (`dataverse.js`) | Shop-specific records that `$expand` onto `swank_Employee` |

The timecard app **reads** the result of the sync indirectly but never writes `swank_employees`. Separation does not split a shared write path.

### Dependency to break
`employee-sync.js` imports `loadConfig` from `./dataverse` — that's its **only** coupling to the rest of the API. It does not use `dataverseFetch`, `getToken`, or any mapper; it carries its own `getToken`, `dvFetch`, and `listAllDv` (lines 40–87) plus a separate `getGraphToken`. Extracting it means copying `loadConfig`'s ~10 relevant fields, not untangling logic.

---

## 4. Configuration

`loadConfig()` in `api/shared/dataverse.js:66-107` resolves env var → `dataverse.local.json` → hardcoded default. The sync needs:

| Env var | `dataverse.local.json` key | Notes |
|---|---|---|
| `DATAVERSE_ORG_URL` | `org_url` | Defaults to `https://org9cab1d0f.crm.dynamics.com` |
| `DATAVERSE_TENANT_ID` | `tenant_id` | |
| `SYNC_CLIENT_ID` | `sync_client_id` | **Falls back to `DATAVERSE_CLIENT_ID`** if unset |
| `SYNC_CLIENT_SECRET` | `sync_client_secret` | **Falls back to `DATAVERSE_CLIENT_SECRET`** if unset |
| `SHAREPOINT_SITE` | `sharepoint_site` | Graph site identifier |
| `SHAREPOINT_FILE_PATH` | `sharepoint_file_path` | Path within the drive |
| `SYNC_EXCEL_PATH` | — | Optional local-file override, used by the HTTP route only |

`dataverse.local.json` is **gitignored** — pull real values from the existing SWA application settings in the Azure portal, not from the repo.

The sync's app registration needs **both** Dataverse (`{orgUrl}/.default`) and Microsoft Graph (`https://graph.microsoft.com/.default`) application permissions, including SharePoint file read. The main API's registration may not have the Graph permissions — verify before assuming `SYNC_CLIENT_*` can be dropped.

> `loadConfig` also has a fallback that reads `../../REPO/MATT KURTH/dataverse.local.json` (line 72-74) — a developer-machine-specific path that should not be carried into the new service.

---

## 5. Options

### Option A — Standalone Azure Function App (recommended)
A new Function App resource on a Consumption plan, containing only the timer trigger and the sync code. It does **not** need to be linked to the Static Web App, because nothing in the browser calls it.

- Timer triggers work normally; Consumption plan cost is negligible for 2 runs/day.
- Fully independent deploy, credentials, and logs — matches the actual domain boundary.
- Requires a new Azure resource and a second deploy pipeline.

### Option B — Bring-your-own-functions linked to SWA
Move the *entire* `api/` folder to a standalone Function App and link it to the SWA.

- Solves the timer restriction and unlocks managed identity and Key Vault references.
- **Requires the SWA Standard plan** (paid), `api_location` must be set to `""`, and linking is supported only in the production environment.
- Much larger blast radius: every existing endpoint moves at once. Hard to justify for one timer.

### Option C — External scheduler calling the existing HTTP endpoint
GitHub Actions cron or a Logic App POSTing to `/api/employee-sync`.

- **Blocked as configured.** `staticwebapp.config.json` requires the `authenticated` role on `/api/*` and 302-redirects 401s to AAD login, so an unattended caller cannot authenticate. Making this work means punching an auth hole (shared-secret header plus a route exemption) — a new public attack surface on an endpoint that mass-mutates the employee roster. Not recommended.

---

## 6. Known defects to fix during the move

1. **Errors are swallowed.** `api/src/functions/employee-sync.js:11-13` catches and only calls `context.error`. Per-row failures inside `runSync` (lines 271–295) are logged and skipped, so a run where *every* row fails still reports success. Given the sync has been silently dead, add real alerting on failure and on an implausible result (for example, zero rows parsed, or a deactivation count above some threshold).
2. **Unsafe mass-deactivation.** Lines 287–297 mark every Dataverse employee absent from the spreadsheet as `swank_active: false`. A truncated or wrong-sheet export would deactivate the entire roster. Add a guard that aborts if parsed row count is zero or deactivations exceed a sane share of the roster.
3. **Dead argument.** Line 216-217 computes a Dataverse `token` and passes it to `readExcelFromSharePoint(token)`, which takes no parameters and fetches its own Graph token. Harmless but misleading; the Dataverse token fetched there is unused until line 233 re-fetches it.
4. **UTC schedule.** `0 0 5,13 * * *` is UTC, so local run times shift by an hour across daylight saving. Confirm 5:00/13:00 UTC is actually intended versus local business hours.
5. **Brittle Excel contract.** Fixed column indices and a substring match on the sheet name, with no validation. A column insert in the ComputerEase export corrupts data silently. Validate the header row before parsing.

---

## 7. Suggested acceptance criteria

- [ ] Sync runs on schedule in Azure and the run is visible in logs.
- [ ] A failed or implausible run raises a visible alert rather than logging quietly.
- [ ] Mass-deactivation guard in place and unit-tested.
- [ ] Credentials live in the new service's settings; no secrets in the repo.
- [ ] `api/src/functions/employee-sync.js` and `api/shared/employee-sync.js` removed from this repo once the new service is live.
- [ ] `POST /api/employee-sync` either removed from this API or repointed at the new service, so there is exactly one way to trigger a sync.
- [ ] TimeCard app still builds and deploys with no non-HTTP triggers (`npm run typecheck` clean; verify trigger list).

---

## 8. Reference

- Deploy workflow: `.github/workflows/azure-static-web-apps-ambitious-bay-0f6873a0f.yml`
- SWA routing/auth: `staticwebapp.config.json`
- Functions runtime config: `api/host.json` (extension bundle `[4.*, 5.0.0)`), `api/package.json` (`main: src/index.js`, Node 20)
- Local dev runs the API through `api/local-server.js`, which bypasses Azure entirely — this is why the sync appears to work locally and not in production.
- Node for this repo is project-local at `.tools\node` (not on PATH):
  ```powershell
  $env:Path = "C:\Users\SebastianS\Coding\Shop\TimeCard\.tools\node;" + $env:Path
  ```
- List registered triggers:
  ```powershell
  node -e "const {app}=require('./api/node_modules/@azure/functions'); const n=[]; for (const k of ['http','timer']) app[k]=(x,o)=>n.push(k+':'+x); require('./api/src/index.js'); console.log(n.join('\n'))"
  ```
