# Shop Timecard

Web app for shop employees to clock labor against Dataverse equipment assets, plus a manager dashboard for daily review and Sunday–Saturday payroll ZIP export.

This is a port of the Power Apps code app onto **Azure Static Web Apps**. The browser never talks to Dataverse. Azure Functions read and write the live tables, so employee numbers, names, and assets always come from Dataverse — nothing in those lists is hardcoded.

## Dataverse tables

| Table | Entity set | Used for |
| --- | --- | --- |
| Shop Employees | `swank_shopemployees` | 4-digit codes, names, road-mechanic flag, and sign-in email for personal Microsoft login |
| Employees | `swank_employees` | Display name on the shop employee lookup |
| Equipment Asset | `swank_equipmentassets` | Asset picker |
| Shop Time Entries | `swank_shoptimeentries` | Clock-in/out and PTO rows |

Environment: `https://org9cab1d0f.crm.dynamics.com/`

### Work email (Employee)

Add a custom column on **Employee** (`swank_employee`) so mechanics signed in with their own Microsoft 365 account are recognized without the kiosk employee code. Shop Employee already links to Employee — the app matches the signed-in M365 address against this field.

| Setting | Value |
| --- | --- |
| Table | Employee (`swank_employee`) |
| Display name | Email |
| Logical name | `swank_email` |
| Type | Email (or Single line of text) |
| Required | No |

Fill it with each mechanic’s work Microsoft 365 address (same address they use to sign into the app). Road mechanics (`swank_isroadmech` on Shop Employee) can clock in/out from their phone. Shop mechanics can use it to view their timecard and mechanic log on a phone, but clock-in/out stays limited to the shop kiosk account.

Grant the **Shop Timecard API** application user **Read** on Employee (if not already) including the new column.

## Local run

1. Copy [`dataverse.local.json.example`](dataverse.local.json.example) to `dataverse.local.json` (gitignored) and fill in the Dataverse app registration, **or** reuse the same file the Matt Kurth sync already has at `C:\Users\SebastianS\Coding\REPO\MATT KURTH\dataverse.local.json`.
2. `npm install`
3. `npm install --prefix api`
4. `npm run dev`
5. Open http://127.0.0.1:5173

Locally the API skips Microsoft login (`DATAVERSE_LOCAL_SKIP_AUTH`). In Azure, Static Web Apps Entra login is required.

## Azure hosting (same path as Matt Kurth)

1. Create a private GitHub repo and push this folder as the repo root.
2. In Azure Portal create a **Static Web App** (Free), GitHub `main`, Custom build:
   - App location: `/`
   - API location: `api`
   - Output location: `dist`
3. Authentication → Microsoft → current tenant only.
4. Add application settings on the Static Web App:
   - `DATAVERSE_ORG_URL`
   - `DATAVERSE_TENANT_ID`
   - `DATAVERSE_CLIENT_ID`
   - `DATAVERSE_CLIENT_SECRET`
   - `MANAGER_EMAILS` (comma-separated, used only for the manager dashboard)
   - `KIOSK_EMAILS` (comma-separated shared shop kiosk Microsoft 365 accounts — these use the 4-digit employee code; all other accounts are matched by **Email** on Employee)
   - `SPEECH_KEY` and `SPEECH_REGION` (Azure Speech resource for voice notes)
   - `SPEECH_CUSTOM_ENDPOINT_ID` (optional Custom Speech deployment id)
   - `SPEECH_MAX_SECONDS` (optional, default `30`)

The Dataverse application user needs:

- Read on `swank_shopemployee`, `swank_employee`, and `swank_equipmentasset`
- Create / Read / Write / Delete on `swank_shoptimeentry`

## Voice notes (Azure Speech)

Notes fields on the employee timecard include a **Voice note** button (max 30 seconds). The browser asks the Functions API for a short-lived Speech token so the Speech key never ships to the client.

1. In Azure Portal create an **Speech service** (Cognitive Services / AI Services) in your preferred region (example: `eastus`).
2. Copy the key and region into SWA app settings (`SPEECH_KEY`, `SPEECH_REGION`), or into local `dataverse.local.json` as `speech_key` / `speech_region`.
3. (Recommended for the shop) In [Speech Studio](https://speech.microsoft.com/portal) → **Custom speech**:
   - Create a project in the same region
   - Upload a small set of shop phrases / labeled audio (asset names, job jargon)
   - Train and **deploy** a model
   - Copy the deployment **Endpoint ID** into `SPEECH_CUSTOM_ENDPOINT_ID`
4. Until a custom model is deployed, leave `SPEECH_CUSTOM_ENDPOINT_ID` blank — the app uses the standard model plus a phrase list of equipment asset names.

Typical cost at ~30 seconds per note stays within or near the free 5 audio hours/month for light shop use.
