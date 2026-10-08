const fs = require('node:fs');
const path = require('node:path');
const { parseEmailList } = require('./sign-in-identity');

const PTO_TIME_TO_VALUE = {
  PTOTimeKey04: 290180000,
  PTOTimeKey18: 290180001,
};
const PTO_VALUE_TO_TIME = {
  290180000: 'PTOTimeKey04',
  290180001: 'PTOTimeKey18',
};
const PTO_TYPE_TO_VALUE = {
  Personal: 290180000,
  Vacation: 290180001,
  Holiday: 290180002,
};
const PTO_VALUE_TO_TYPE = {
  290180000: 'Personal',
  290180001: 'Vacation',
  290180002: 'Holiday',
};
const PAY_TYPE_TO_VALUE = {
  JR: 290180000,
  SR: 290180001,
  DoubleTime: 290180002,
};
const PAY_VALUE_TO_TYPE = {
  290180000: 'JR',
  290180001: 'SR',
  290180002: 'DoubleTime',
};

const PTO_APPROVAL_TO_VALUE = {
  Pending: 290180000,
  Approved: 290180001,
  Denied: 290180002,
};
const PTO_APPROVAL_VALUE_TO_KEY = {
  290180000: 'Pending',
  290180001: 'Approved',
  290180002: 'Denied',
};

let cachedToken = { value: '', expiresAt: 0 };
let cachedConfig = null;

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    // Strip a UTF-8 BOM; editors and PowerShell add one and JSON.parse rejects it.
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    // Loud on purpose: silently skipping a present-but-broken config caused a
    // fallback to another project's credentials.
    console.warn(`[config] ${filePath} exists but could not be parsed: ${error.message}`);
    return null;
  }
}

function cleanEnv(name) {
  const raw = process.env[name];
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const isAzure = Boolean(process.env.WEBSITE_SITE_NAME);
  const root = path.resolve(__dirname, '..', '..');
  const local = isAzure ? null : readJsonIfExists(path.join(root, 'dataverse.local.json'));
  const mattKurth = isAzure ? null : readJsonIfExists(path.join(root, '..', '..', 'REPO', 'MATT KURTH', 'dataverse.local.json'));
  const fileCfg = local || mattKurth || {};

  const orgUrl = (cleanEnv('DATAVERSE_ORG_URL') || fileCfg.org_url || 'https://org9cab1d0f.crm.dynamics.com').replace(/\/$/, '');

  const defaultManagerEmails =
    'alisonh@swankco.com,bryank@swankco.com,beaul@swankco.com,sebastians@swankco.com,nickl@swankco.com';
  // Deployed with the repo — Azure/local env vars may override. dataverse.local.json is gitignored and not read on Azure.
  const defaultKioskEmails = 'shoptimecard@swankco.com,shopkiosk@swankco.com,mechanicshop@swankco.com';

  // Union, not replace: a partial MANAGER_EMAILS setting used to drop everyone
  // who was only in the built-in list, so some managers signed in and were denied.
  const managerEmails = [
    ...new Set([
      ...parseEmailList(defaultManagerEmails),
      ...parseEmailList(cleanEnv('MANAGER_EMAILS')),
      ...parseEmailList(fileCfg.manager_emails),
    ]),
  ];

  const kioskEmails = [
    ...new Set([
      ...parseEmailList(defaultKioskEmails),
      ...parseEmailList(cleanEnv('KIOSK_EMAILS')),
      ...parseEmailList(fileCfg.kiosk_emails),
    ]),
  ];

  cachedConfig = {
    orgUrl,
    api: `${orgUrl}/api/data/v9.2`,
    tenantId: cleanEnv('DATAVERSE_TENANT_ID') || fileCfg.tenant_id || '',
    clientId: cleanEnv('DATAVERSE_CLIENT_ID') || fileCfg.client_id || '',
    clientSecret: cleanEnv('DATAVERSE_CLIENT_SECRET') || fileCfg.client_secret || '',
    syncClientId: cleanEnv('SYNC_CLIENT_ID') || fileCfg.sync_client_id || '',
    syncClientSecret: cleanEnv('SYNC_CLIENT_SECRET') || fileCfg.sync_client_secret || '',
    sharePointSite: cleanEnv('SHAREPOINT_SITE') || fileCfg.sharepoint_site || '',
    sharePointFilePath: cleanEnv('SHAREPOINT_FILE_PATH') || fileCfg.sharepoint_file_path || '',
    managerEmails,
    kioskEmails,
  };
  return cachedConfig;
}

function normalizeSignInEmail(value) {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  return email || undefined;
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      'Dataverse credentials are missing. Set DATAVERSE_TENANT_ID, DATAVERSE_CLIENT_ID, and DATAVERSE_CLIENT_SECRET, or add dataverse.local.json.',
    );
  }
  return cfg;
}

async function getToken() {
  const now = Date.now();
  if (cachedToken.value && now < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const cfg = requireConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials',
    scope: `${cfg.orgUrl}/.default`,
  });
  const response = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unable to get a Dataverse token (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Unable to get a Dataverse token.');
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

async function dataverseFetch(method, urlPath, body) {
  const cfg = requireConfig();
  const token = await getToken();
  const url = urlPath.startsWith('http') ? urlPath : `${cfg.api}${urlPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Content-Type': 'application/json',
      Prefer: 'odata.include-annotations="*",return=representation,odata.maxpagesize=5000',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(
      `Dataverse ${method} failed (${response.status}). ${text.replace(/\s+/g, ' ').slice(0, 240) || 'Empty response'}`,
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const message = data.error?.message || data.error_description || `Dataverse ${method} failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function listAll(path) {
  const rows = [];
  let next = path;
  while (next) {
    const page = await dataverseFetch('GET', next);
    rows.push(...(page.value || []));
    next = page['@odata.nextLink'] || '';
  }
  return rows;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function mapShopEmployee(row) {
  const related = row.swank_Employee || {};
  const name = related.swank_name || row.swank_employeename || row['_swank_employee_value@OData.Community.Display.V1.FormattedValue'];
  return {
    id: row.swank_shopemployeeid,
    autoNumber: row.swank_autonumber || '',
    empNum: toNumber(row.swank_empnum ?? related.swank_empnum),
    // Nullable in Dataverse: rows predating the column read as null, which means
    // shop mechanic. Only an explicit true is a road mechanic.
    isRoadMech: row.swank_isroadmech === true,
    isAdmin: row.swank_isadmin === true,
    signInEmail: normalizeSignInEmail(related.swank_companyemail ?? row.swank_signinemail),
    employee: name
      ? {
          id: related.swank_employeeid || row._swank_employee_value,
          name1: name,
        }
      : undefined,
  };
}

function mapAsset(row) {
  return {
    id: row.swank_equipmentassetid,
    asset: row.swank_assetidentifier || '',
    assetDetail: row.swank_assetdetails || undefined,
    divisionCode: toNumber(row.swank_divisioncode),
    divisionKey: row['swank_divisionname@OData.Community.Display.V1.FormattedValue'] || undefined,
    equipmentCategory: row.swank_equipmentcategory ?? undefined,
    equipmentCategoryLabel: row['swank_equipmentcategory@OData.Community.Display.V1.FormattedValue'] || undefined,
  };
}

function mapTimeEntry(row) {
  const employee = row.swank_Employee || {};
  const asset = row.swank_Asset || {};
  return {
    id: row.swank_shoptimeentryid,
    timeEntry: row.swank_timeentry || '',
    asset: asset.swank_assetidentifier
      ? {
          id: asset.swank_equipmentassetid || row._swank_asset_value,
          asset: asset.swank_assetidentifier,
        }
      : row._swank_asset_value
        ? { id: row._swank_asset_value, asset: row.swank_assetname || '' }
        : undefined,
    assetDivision: toNumber(row.swank_assetdivision),
    clockIn: row.swank_clockin || undefined,
    clockInIp: row.swank_clockinip || undefined,
    clockInLat: toNumber(row.swank_clockinlat),
    clockInLon: toNumber(row.swank_clockinlon),
    clockOut: row.swank_clockout || undefined,
    clockOutIp: row.swank_clockoutip || undefined,
    clockOutLat: toNumber(row.swank_clockoutlat),
    clockOutLon: toNumber(row.swank_clockoutlon),
    division: toNumber(row.crcce_division),
    employee:
      employee.swank_shopemployeeid || row._swank_employee_value
        ? {
            id: employee.swank_shopemployeeid || row._swank_employee_value,
            autoNumber: employee.swank_autonumber || row.swank_employeename || '',
          }
        : undefined,
    hours: toNumber(row.swank_hours),
    jobNumber: row.swank_jobnumber || undefined,
    notes: row.swank_notes || undefined,
    onCall: row.swank_oncall === true,
    payTypeKey: PAY_VALUE_TO_TYPE[row.swank_paytype] || undefined,
    ptoApproval: PTO_APPROVAL_VALUE_TO_KEY[row.swank_ptoapproval] || undefined,
    pTOTimeKey: PTO_VALUE_TO_TIME[row.swank_ptotime],
    pTOTypeKey: PTO_VALUE_TO_TYPE[row.swank_ptotype],
    workDate: row.swank_workdate || undefined,
  };
}

function timeEntryPayload(record, { isCreate }) {
  const payload = {};
  if (record.timeEntry || isCreate) {
    payload.swank_timeentry = record.timeEntry || 'Time entry';
  }
  if (record.clockIn !== undefined) payload.swank_clockin = record.clockIn || null;
  if (record.clockInIp !== undefined) payload.swank_clockinip = record.clockInIp || null;
  if (record.clockInLat !== undefined) payload.swank_clockinlat = record.clockInLat ?? null;
  if (record.clockInLon !== undefined) payload.swank_clockinlon = record.clockInLon ?? null;
  if (record.clockOut !== undefined) payload.swank_clockout = record.clockOut || null;
  if (record.clockOutIp !== undefined) payload.swank_clockoutip = record.clockOutIp || null;
  if (record.clockOutLat !== undefined) payload.swank_clockoutlat = record.clockOutLat ?? null;
  if (record.clockOutLon !== undefined) payload.swank_clockoutlon = record.clockOutLon ?? null;
  if (record.hours !== undefined) payload.swank_hours = record.hours;
  if (record.jobNumber !== undefined) payload.swank_jobnumber = record.jobNumber || null;
  if (record.notes !== undefined) {
    const notes = typeof record.notes === 'string' ? record.notes.trim() : '';
    payload.swank_notes = notes || null;
  }
  if (record.workDate !== undefined) payload.swank_workdate = record.workDate || null;
  if (record.assetDivision !== undefined) payload.swank_assetdivision = record.assetDivision;
  if (record.division !== undefined) payload.crcce_division = record.division;
  if (record.onCall !== undefined) payload.swank_oncall = Boolean(record.onCall);
  if (record.ptoApproval !== undefined) {
    payload.swank_ptoapproval = PTO_APPROVAL_TO_VALUE[record.ptoApproval] ?? null;
  }
  if (record.pTOTimeKey !== undefined) {
    payload.swank_ptotime = PTO_TIME_TO_VALUE[record.pTOTimeKey] ?? null;
  }
  if (record.pTOTypeKey !== undefined) {
    payload.swank_ptotype = PTO_TYPE_TO_VALUE[record.pTOTypeKey] ?? null;
  }
  if (record.payTypeKey !== undefined) {
    payload.swank_paytype = PAY_TYPE_TO_VALUE[record.payTypeKey] ?? null;
  } else if (isCreate) {
    payload.swank_paytype = PAY_TYPE_TO_VALUE.SR;
  }
  if (record.employee?.id) {
    payload['swank_Employee@odata.bind'] = `/swank_shopemployees(${record.employee.id})`;
  }
  if (record.asset?.id) {
    payload['swank_Asset@odata.bind'] = `/swank_equipmentassets(${record.asset.id})`;
  } else if (record.asset === null) {
    payload.swank_asset = null;
  }
  return payload;
}

const SHOP_EMPLOYEE_SELECT =
  'swank_shopemployeeid,swank_autonumber,swank_empnum,swank_isroadmech,swank_isadmin,_swank_employee_value';
const SHOP_EMPLOYEE_EXPAND =
  '&$expand=swank_Employee($select=swank_employeeid,swank_name,swank_empnum,swank_companyemail)';

async function listEmployees() {
  try {
    const rows = await listAll(
      `/swank_shopemployees?$select=${SHOP_EMPLOYEE_SELECT}${SHOP_EMPLOYEE_EXPAND}&$filter=statecode eq 0&$orderby=swank_autonumber`,
    );
    return rows.map(mapShopEmployee).filter((row) => typeof row.empNum === 'number');
  } catch (error) {
    try {
      const rows = await listAll(
        `/swank_shopemployees?$select=${SHOP_EMPLOYEE_SELECT}&$expand=swank_Employee($select=swank_employeeid,swank_name,swank_empnum)&$filter=statecode eq 0&$orderby=swank_autonumber`,
      );
      return rows.map(mapShopEmployee).filter((row) => typeof row.empNum === 'number');
    } catch {
      throw error;
    }
  }
}

async function findShopEmployeeBySignInEmail(email) {
  const normalized = normalizeSignInEmail(email);
  if (!normalized) return null;
  const escaped = normalized.replace(/'/g, "''");
  try {
    const rows = await listAll(
      `/swank_shopemployees?$select=${SHOP_EMPLOYEE_SELECT}${SHOP_EMPLOYEE_EXPAND}&$filter=statecode eq 0 and swank_Employee/swank_companyemail eq '${escaped}'`,
    );
    const match = rows.map(mapShopEmployee).find((row) => typeof row.empNum === 'number');
    if (match) return match;
  } catch {
    // Column may not exist yet — fall back to scanning the roster.
  }
  const roster = await listEmployees();
  return roster.find((row) => row.signInEmail === normalized) || null;
}

async function getTimeEntryPunch(id) {
  const row = await dataverseFetch(
    'GET',
    `/swank_shoptimeentries(${id})?$select=swank_shoptimeentryid,_swank_employee_value,swank_clockin,swank_clockout,swank_hours,swank_workdate`,
  );
  return {
    id: row.swank_shoptimeentryid,
    employeeId: row._swank_employee_value || undefined,
    clockIn: row.swank_clockin || undefined,
    clockOut: row.swank_clockout || undefined,
    hours: toNumber(row.swank_hours),
    workDate: row.swank_workdate || undefined,
  };
}

async function listEmployeeTimeEntries(employeeId, { from, to }) {
  const rows = await listAll(
    `/swank_shoptimeentries?$select=swank_shoptimeentryid,swank_timeentry,swank_clockin,swank_clockout,swank_jobnumber,swank_workdate,swank_ptotime,swank_notes&$filter=statecode eq 0 and _swank_employee_value eq ${employeeId} and swank_clockin ge ${from} and swank_clockin le ${to}`,
  );
  return rows.map(mapTimeEntry);
}

async function listAssets() {
  const rows = await listAll(
    '/swank_equipmentassets?$select=swank_equipmentassetid,swank_assetidentifier,swank_assetdetails,swank_divisioncode,swank_divisionname,swank_equipmentcategory&$filter=statecode eq 0&$orderby=swank_assetidentifier',
  );
  return rows.map(mapAsset).filter((row) => row.id && row.asset);
}

async function createAsset(record) {
  const payload = {};
  if (record.asset) payload.swank_assetidentifier = record.asset;
  if (record.assetDetail) payload.swank_assetdetails = record.assetDetail;
  if (record.divisionCode !== undefined) payload.swank_divisioncode = record.divisionCode;
  if (record.divisionPicklist !== undefined) payload.swank_divisionname = record.divisionPicklist;
  if (record.equipmentCategory !== undefined) payload.swank_equipmentcategory = record.equipmentCategory;
  const created = await dataverseFetch('POST', '/swank_equipmentassets', payload);
  return mapAsset(created);
}

async function updateAsset(id, record) {
  const payload = {};
  if (record.asset !== undefined) payload.swank_assetidentifier = record.asset;
  if (record.assetDetail !== undefined) payload.swank_assetdetails = record.assetDetail || null;
  if (record.divisionCode !== undefined) payload.swank_divisioncode = record.divisionCode;
  if (record.divisionPicklist !== undefined) payload.swank_divisionname = record.divisionPicklist;
  if (record.equipmentCategory !== undefined) payload.swank_equipmentcategory = record.equipmentCategory;
  const updated = await dataverseFetch('PATCH', `/swank_equipmentassets(${id})`, payload);
  return mapAsset(updated);
}

async function deactivateAsset(id) {
  await dataverseFetch('PATCH', `/swank_equipmentassets(${id})`, { statecode: 1, statuscode: 2 });
}

async function listTimeEntries({ from, to } = {}) {
  let filter = 'statecode eq 0';
  if (from) filter += ` and swank_clockin ge ${from}`;
  if (to) filter += ` and swank_clockin le ${to}`;
  const rows = await listAll(
    `/swank_shoptimeentries?$select=swank_shoptimeentryid,swank_timeentry,swank_clockin,swank_clockout,swank_hours,swank_jobnumber,swank_notes,swank_workdate,swank_assetdivision,crcce_division,swank_ptotime,swank_ptotype,swank_paytype,swank_oncall,swank_ptoapproval,swank_clockinip,swank_clockinlat,swank_clockinlon,swank_clockoutip,swank_clockoutlat,swank_clockoutlon,_swank_employee_value,_swank_asset_value&$expand=swank_Employee($select=swank_shopemployeeid,swank_autonumber,swank_empnum),swank_Asset($select=swank_equipmentassetid,swank_assetidentifier,swank_divisioncode)&$filter=${filter}&$orderby=swank_clockin desc`,
  );
  return rows.map(mapTimeEntry);
}

async function createShopEmployee(record) {
  const payload = {};
  if (record.autoNumber) payload.swank_autonumber = record.autoNumber;
  if (record.empNum !== undefined) payload.swank_empnum = record.empNum;
  if (record.isRoadMech !== undefined) payload.swank_isroadmech = Boolean(record.isRoadMech);
  if (record.isAdmin !== undefined) payload.swank_isadmin = Boolean(record.isAdmin);
  if (record.employeeId) {
    payload['swank_Employee@odata.bind'] = `/swank_employees(${record.employeeId})`;
  }
  const created = await dataverseFetch('POST', '/swank_shopemployees', payload);
  return mapShopEmployee(created);
}

async function updateShopEmployee(id, record) {
  const payload = {};
  if (record.autoNumber !== undefined) payload.swank_autonumber = record.autoNumber || null;
  if (record.empNum !== undefined) payload.swank_empnum = record.empNum;
  if (record.isRoadMech !== undefined) payload.swank_isroadmech = Boolean(record.isRoadMech);
  if (record.isAdmin !== undefined) payload.swank_isadmin = Boolean(record.isAdmin);
  if (record.employeeId !== undefined) {
    payload['swank_Employee@odata.bind'] = record.employeeId ? `/swank_employees(${record.employeeId})` : null;
  }
  const updated = await dataverseFetch('PATCH', `/swank_shopemployees(${id})`, payload);
  return mapShopEmployee(updated);
}

async function deactivateShopEmployee(id) {
  await dataverseFetch('PATCH', `/swank_shopemployees(${id})`, { statecode: 1, statuscode: 2 });
}

async function listLookupEmployees() {
  const rows = await listAll(
    '/swank_employees?$select=swank_employeeid,swank_name,swank_empnum&$filter=statecode eq 0&$orderby=swank_name',
  );
  return rows
    .map((row) => ({
      id: row.swank_employeeid,
      name: row.swank_name || '',
      empNum: toNumber(row.swank_empnum),
    }))
    .filter((row) => row.id && row.name);
}

async function ensureShopEmployeeDisplayName(shopEmployeeId) {
  if (!shopEmployeeId) return;
  try {
    const row = await dataverseFetch(
      'GET',
      `/swank_shopemployees(${shopEmployeeId})?$select=swank_autonumber&$expand=swank_Employee($select=swank_name)`,
    );
    const name = row.swank_Employee?.swank_name;
    if (!name || row.swank_autonumber) return;
    await dataverseFetch('PATCH', `/swank_shopemployees(${shopEmployeeId})`, { swank_autonumber: name });
  } catch {
    // Clock-in should still succeed if the display name cannot be written.
  }
}

async function createTimeEntry(record) {
  await ensureShopEmployeeDisplayName(record.employee?.id);
  const created = await dataverseFetch('POST', '/swank_shoptimeentries', timeEntryPayload(record, { isCreate: true }));
  return mapTimeEntry(created);
}

async function updateTimeEntry(id, record) {
  const updated = await dataverseFetch('PATCH', `/swank_shoptimeentries(${id})`, timeEntryPayload(record, { isCreate: false }));
  return mapTimeEntry(updated);
}

const OPEN_PUNCH_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;
const AUTO_CLOCK_OUT_MS = 16 * 60 * 60 * 1000;
const AUTO_CLOCK_OUT_MARKER = '[AUTO_CLOCK_OUT]';

function isPtoRow(entry) {
  return Boolean(entry?.pTOTimeKey) || entry?.jobNumber === 'PTO' || String(entry?.timeEntry || '').toLowerCase().includes(' - pto');
}

function autoClockOutDue(entry, now) {
  if (!entry?.clockIn || entry.clockOut || isPtoRow(entry)) return false;
  const start = new Date(entry.clockIn).getTime();
  return Number.isFinite(start) && now >= start + AUTO_CLOCK_OUT_MS;
}

function withAutoClockOutMarker(notes) {
  if (String(notes || '').includes(AUTO_CLOCK_OUT_MARKER)) return notes;
  const trimmed = String(notes || '').trim();
  return trimmed ? `${AUTO_CLOCK_OUT_MARKER} ${trimmed}` : AUTO_CLOCK_OUT_MARKER;
}

/**
 * Closes every open punch that has run 16 hours. The clock-out is clock-in plus
 * 16 hours, and the row is marked for a manager to replace that time.
 */
async function applyAutoClockOuts(entries) {
  const now = Date.now();
  const due = entries.filter((entry) => autoClockOutDue(entry, now));
  if (due.length === 0) return entries;
  const closedById = new Map();
  for (const entry of due) {
    const clockOut = new Date(new Date(entry.clockIn).getTime() + AUTO_CLOCK_OUT_MS).toISOString();
    const notes = withAutoClockOutMarker(entry.notes);
    const fields = { clockOut, hours: 16, notes };
    try {
      closedById.set(entry.id, await updateTimeEntry(entry.id, fields));
    } catch {
      try {
        const withoutHours = { clockOut, notes };
        closedById.set(entry.id, await updateTimeEntry(entry.id, withoutHours));
      } catch {
        // Leave the punch open when Dataverse rejects the close. It stays visible as active.
      }
    }
  }
  return entries.map((entry) => closedById.get(entry.id) || entry);
}

async function autoCloseExpiredPunches(employeeId) {
  if (!employeeId) return [];
  const now = Date.now();
  const recent = await listEmployeeTimeEntries(employeeId, {
    from: new Date(now - OPEN_PUNCH_LOOKBACK_MS).toISOString(),
    to: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  });
  return applyAutoClockOuts(recent);
}

function isOpenLaborRow(entry) {
  if (!entry?.clockIn || entry.clockOut) return false;
  if (entry.jobNumber === 'PTO' || entry.pTOTimeKey) return false;
  return true;
}

function elapsedHours(clockIn, clockOut) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

function requestedHours(entries, id) {
  const match = (entries || []).find((row) => row && row.id === id);
  const hours = Number(match?.hours);
  return Number.isFinite(hours) && hours >= 0 ? hours : undefined;
}

/**
 * Closes every open labor punch for an employee. Hours are best-effort: a
 * rejected hours value is retried as a clock-out only so a bad duration cannot
 * leave the punch open. A manager can correct the time afterward.
 */
async function closeOpenPunches(employeeId, { clockOut, lat, lon, ip, entries = [] } = {}) {
  const now = Date.now();
  const recent = await listEmployeeTimeEntries(employeeId, {
    from: new Date(now - OPEN_PUNCH_LOOKBACK_MS).toISOString(),
    to: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  });
  const open = recent.filter(isOpenLaborRow);
  const seen = new Set(open.map((entry) => entry.id));
  const failures = [];

  for (const row of entries) {
    const id = row?.id;
    if (!id || seen.has(id)) continue;
    try {
      const punch = await getTimeEntryPunch(id);
      if (punch.employeeId !== employeeId || !isOpenLaborRow(punch)) continue;
      open.push(punch);
      seen.add(id);
    } catch (error) {
      failures.push(error.message || `Could not read punch ${id}.`);
    }
  }

  if (open.length === 0) {
    const error = new Error(failures[0] || 'No open punch to clock out.');
    error.status = failures.length ? 500 : 409;
    throw error;
  }

  open.sort((entryA, entryB) => new Date(entryA.clockIn).getTime() - new Date(entryB.clockIn).getTime());
  const due = open.filter((entry) => autoClockOutDue(entry, now));
  const live = open.filter((entry) => !autoClockOutDue(entry, now));
  const at = clockOut && Number.isFinite(new Date(clockOut).getTime()) ? clockOut : new Date().toISOString();
  const closed = (await applyAutoClockOuts(due)).filter((entry) => entry.clockOut);

  for (const entry of live) {
    const fields = { clockOut: at };
    const hours = requestedHours(entries, entry.id);
    fields.hours = hours !== undefined ? hours : elapsedHours(entry.clockIn, at);
    if (typeof lat === 'number') fields.clockOutLat = lat;
    if (typeof lon === 'number') fields.clockOutLon = lon;
    if (ip) fields.clockOutIp = ip;
    try {
      closed.push(await updateTimeEntry(entry.id, fields));
    } catch (error) {
      try {
        const withoutHours = { ...fields };
        delete withoutHours.hours;
        closed.push(await updateTimeEntry(entry.id, withoutHours));
      } catch (retryError) {
        failures.push(retryError.message || error.message || 'Unable to clock out.');
      }
    }
  }

  if (closed.length === 0) {
    const error = new Error(failures[0] || 'Unable to clock out.');
    error.status = 500;
    throw error;
  }

  return { closed, failures };
}

async function deleteTimeEntry(id) {
  await dataverseFetch('DELETE', `/swank_shoptimeentries(${id})`);
}

async function listSchedules({ from, to } = {}) {
  let filter = 'statecode eq 0';
  if (from) filter += ` and swank_scheduledate ge ${from}`;
  if (to) filter += ` and swank_scheduledate le ${to}`;
  const rows = await listAll(
    `/swank_mechanicschedules?$select=swank_mechanicscheduleid,swank_schedulekey,swank_scheduledate,swank_scheduledstart,swank_oncall,_swank_employee_value&$filter=${filter}&$orderby=swank_scheduledate`,
  );
  return rows.map((row) => ({
    id: row.swank_mechanicscheduleid,
    scheduleKey: row.swank_schedulekey || '',
    scheduleDate: row.swank_scheduledate || '',
    scheduledStart: row.swank_scheduledstart || undefined,
    onCall: row.swank_oncall === true,
    employeeId: row._swank_employee_value || undefined,
  }));
}

async function upsertSchedule(record) {
  const payload = {};
  if (record.scheduleKey !== undefined) payload.swank_schedulekey = record.scheduleKey;
  if (record.scheduledStart !== undefined) payload.swank_scheduledstart = record.scheduledStart || null;
  if (record.onCall !== undefined) payload.swank_oncall = Boolean(record.onCall);
  if (record.scheduleDate !== undefined) payload.swank_scheduledate = record.scheduleDate;
  if (record.employeeId) {
    payload['swank_Employee@odata.bind'] = `/swank_shopemployees(${record.employeeId})`;
  }

  // Upsert through the swank_schedulealtkey alternate key (swank_employee +
  // swank_scheduledate). The lookup half of the key must be addressed by its
  // value property, `_swank_employee_value`; using the navigation property name
  // is rejected with 400 "The key in the request URI is not valid".
  const keyPath = `_swank_employee_value=${record.employeeId},swank_scheduledate=${record.scheduleDate}`;
  try {
    return await dataverseFetch('PATCH', `/swank_mechanicschedules(${keyPath})`, payload);
  } catch (error) {
    if (String(error.message).includes('404') || String(error.message).includes('Does Not Exist')) {
      return await dataverseFetch('POST', '/swank_mechanicschedules', payload);
    }
    throw error;
  }
}

async function diagnose() {
  const cfg = loadConfig();
  let orgHost = cfg.orgUrl;
  try {
    orgHost = new URL(cfg.orgUrl).host;
  } catch {
    // keep raw value
  }
  const result = {
    hasOrgUrl: Boolean(cfg.orgUrl),
    orgHost,
    hasTenantId: Boolean(cfg.tenantId),
    hasClientId: Boolean(cfg.clientId),
    clientIdTail: cfg.clientId ? cfg.clientId.slice(-4) : '',
    hasClientSecret: Boolean(cfg.clientSecret),
    tokenOk: false,
    employeeCount: null,
    error: null,
  };
  try {
    await getToken();
    result.tokenOk = true;
    result.employeeCount = (await listEmployees()).length;
  } catch (error) {
    result.error = error.message || String(error);
  }
  return result;
}

module.exports = {
  loadConfig,
  diagnose,
  listEmployees,
  findShopEmployeeBySignInEmail,
  getTimeEntryPunch,
  listEmployeeTimeEntries,
  listLookupEmployees,
  listAssets,
  createAsset,
  updateAsset,
  deactivateAsset,
  createShopEmployee,
  updateShopEmployee,
  deactivateShopEmployee,
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  closeOpenPunches,
  applyAutoClockOuts,
  autoCloseExpiredPunches,
  deleteTimeEntry,
  listSchedules,
  upsertSchedule,
};
