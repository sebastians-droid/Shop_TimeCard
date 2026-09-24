const ExcelJS = require('exceljs');
const { loadConfig } = require('./dataverse');

const DEPT_LABEL_TO_VALUE = {
  'CONSTRUCTI': 290180000,
  'GRIND': 290180001,
  'MANAGMNT': 290180002,
  'MGMT CONST': 290180003,
  'MGMT MILL': 290180004,
  'MGMT S/S': 290180005,
  'MGMT S/SBT': 290180006,
  'MGMT SS VA': 290180007,
  'MILLING': 290180008,
  'OFFIC/CONS': 290180009,
  'OFFICE VB': 290180010,
  'OFFICE/PR': 290180019,
  'SAFE/TRAIN': 290180011,
  'SAW/SEAL': 290180012,
  'SAW/SEALBT': 290180013,
  'SAW/SEALVB': 290180014,
  'SBH FARM': 290180015,
  'SCC FARM': 290180016,
  'SHOP/MILL': 290180017,
  'SHOP/PR': 290180018,
};

function loadSyncConfig() {
  const cfg = loadConfig();
  return {
    orgUrl: cfg.orgUrl,
    api: cfg.api,
    tenantId: cfg.tenantId,
    clientId: cfg.syncClientId || cfg.clientId,
    clientSecret: cfg.syncClientSecret || cfg.clientSecret,
    sharePointSite: cfg.sharePointSite,
    sharePointFilePath: cfg.sharePointFilePath,
  };
}

async function getToken() {
  const cfg = loadSyncConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials',
    scope: `${cfg.orgUrl}/.default`,
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  );
  const data = await r.json();
  if (!data.access_token) throw new Error(data.error_description || 'Token error');
  return data.access_token;
}

async function dvFetch(token, method, path, body) {
  const cfg = loadSyncConfig();
  const url = path.startsWith('http') ? path : `${cfg.api}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'PATCH' && r.status === 204) return {};
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function listAllDv(token, path) {
  const rows = [];
  let next = path;
  while (next) {
    const page = await dvFetch(token, 'GET', next);
    rows.push(...(page.value || []));
    next = page['@odata.nextLink'] || '';
  }
  return rows;
}

function parseExcelRow(row) {
  const empNum = parseInt(row.getCell(1).text.trim(), 10);
  if (isNaN(empNum)) return null;

  return {
    empNum,
    name: row.getCell(2).text.trim() || '',
    address1: row.getCell(3).text.trim() || null,
    address2: row.getCell(4).text.trim() || null,
    address3: row.getCell(5).text.trim() || null,
    phone: row.getCell(6).text.trim() || null,
    department: row.getCell(7).text.trim() || null,
    unionName: row.getCell(9).text.trim() || null,
    unionLocal: row.getCell(10).text.trim() || null,
    className: row.getCell(11).text.trim() || null,
    exportId: row.getCell(12).text.trim() || null,
  };
}

function buildPayload(ceRow, unionMap, classMap) {
  const payload = {
    swank_name: ceRow.name,
    swank_empnum: ceRow.empNum,
    swank_phonenum: ceRow.phone,
    swank_address1: ceRow.address1,
    swank_address2: ceRow.address2,
    swank_address3: ceRow.address3,
    swank_unionlocal: ceRow.unionLocal,
    swank_exportid: ceRow.exportId,
    swank_active: true,
  };
  const deptVal = DEPT_LABEL_TO_VALUE[ceRow.department];
  if (deptVal !== undefined) payload.swank_department = deptVal;

  const unionId = ceRow.unionName ? unionMap.get(ceRow.unionName) : null;
  if (unionId) {
    payload['swank_Union@odata.bind'] = `/swank_unions(${unionId})`;
  }

  const classKey = ceRow.unionName && ceRow.className ? `${ceRow.unionName} - ${ceRow.className}` : ceRow.className;
  const classId = classKey ? classMap.get(classKey) : null;
  if (classId) {
    payload['swank_Class@odata.bind'] = `/swank_classes(${classId})`;
  }

  return payload;
}

function extractGuid(odataBind) {
  if (!odataBind) return null;
  const m = odataBind.match(/\(([0-9a-f-]{36})\)/i);
  return m ? m[1] : null;
}

function fieldsChanged(dvRow, payload) {
  const checks = [
    [dvRow.swank_name, payload.swank_name],
    [dvRow.swank_phonenum, payload.swank_phonenum],
    [dvRow.swank_address1, payload.swank_address1],
    [dvRow.swank_address2, payload.swank_address2],
    [dvRow.swank_address3, payload.swank_address3],
    [dvRow.swank_unionlocal, payload.swank_unionlocal],
    [dvRow.swank_exportid, payload.swank_exportid],
    [dvRow.swank_active, payload.swank_active],
  ];
  if (payload.swank_department !== undefined) {
    checks.push([dvRow.swank_department, payload.swank_department]);
  }
  const newUnionId = extractGuid(payload['swank_Union@odata.bind']);
  if (newUnionId) checks.push([dvRow._swank_union_value, newUnionId]);
  const newClassId = extractGuid(payload['swank_Class@odata.bind']);
  if (newClassId) checks.push([dvRow._swank_class_value, newClassId]);
  return checks.some(([a, b]) => (a || null) !== (b || null));
}

async function readExcelFromSharePoint() {
  const cfg = loadSyncConfig();
  const graphToken = await getGraphToken();
  const siteUrl = cfg.sharePointSite || '';
  const filePath = cfg.sharePointFilePath || '';

  if (!siteUrl || !filePath) return null;

  const siteR = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteUrl}`,
    { headers: { Authorization: `Bearer ${graphToken}` } },
  );
  if (!siteR.ok) throw new Error(`Graph site lookup failed: ${siteR.status}`);
  const site = await siteR.json();

  const driveR = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/root:/${filePath}:/content`,
    { headers: { Authorization: `Bearer ${graphToken}` } },
  );
  if (!driveR.ok) throw new Error(`Graph file download failed: ${driveR.status}`);
  return Buffer.from(await driveR.arrayBuffer());
}

async function getGraphToken() {
  const cfg = loadSyncConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  );
  const data = await r.json();
  if (!data.access_token) throw new Error(data.error_description || 'Graph token error');
  return data.access_token;
}

async function runSync({ excelPath, excelBuffer } = {}) {
  const log = [];
  const info = (msg) => { log.push(msg); console.log(`[sync] ${msg}`); };

  info('Starting ComputerEase → Dataverse employee sync');

  const wb = new ExcelJS.Workbook();
  if (excelBuffer) {
    await wb.xlsx.load(excelBuffer);
  } else if (excelPath) {
    await wb.xlsx.readFile(excelPath);
  } else {
    const token = await getToken();
    const buf = await readExcelFromSharePoint(token);
    if (!buf) throw new Error('No Excel source configured (set excelPath or SharePoint config)');
    await wb.xlsx.load(buf);
  }

  const ws = wb.worksheets.find(s => s.name.toLowerCase().includes('premployee'));
  if (!ws) throw new Error('Sheet "premployee" not found in workbook');
  info(`Excel sheet "${ws.name}" has ${ws.rowCount} rows`);

  const ceEmployees = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const parsed = parseExcelRow(ws.getRow(r));
    if (parsed) ceEmployees.push(parsed);
  }
  info(`Parsed ${ceEmployees.length} employees from ComputerEase`);

  const token = await getToken();

  const unionRows = await listAllDv(token, '/swank_unions?$select=swank_unionid,swank_union1&$filter=statecode eq 0');
  const unionMap = new Map();
  for (const row of unionRows) unionMap.set(row.swank_union1, row.swank_unionid);
  info(`Loaded ${unionMap.size} unions from Dataverse`);

  const classRows = await listAllDv(token, '/swank_classes?$select=swank_classid,swank_classcode,swank_classkey&$filter=statecode eq 0');
  const classMap = new Map();
  for (const row of classRows) {
    if (row.swank_classkey) classMap.set(row.swank_classkey, row.swank_classid);
    if (row.swank_classcode) classMap.set(row.swank_classcode, row.swank_classid);
  }
  info(`Loaded ${classMap.size} classes from Dataverse`);

  const dvRows = await listAllDv(
    token,
    '/swank_employees?$select=swank_employeeid,swank_empnum,swank_name,swank_phonenum,swank_address1,swank_address2,swank_address3,swank_department,swank_unionlocal,swank_exportid,swank_active,_swank_union_value,_swank_class_value&$filter=statecode eq 0',
  );
  info(`Found ${dvRows.length} active employees in Dataverse`);

  const dvByEmpNum = new Map();
  for (const row of dvRows) {
    if (row.swank_empnum != null) dvByEmpNum.set(row.swank_empnum, row);
  }

  const ceEmpNums = new Set(ceEmployees.map(e => e.empNum));
  let created = 0, updated = 0, deactivated = 0, unchanged = 0;

  for (const ce of ceEmployees) {
    const existing = dvByEmpNum.get(ce.empNum);
    const payload = buildPayload(ce, unionMap, classMap);

    if (!existing) {
      try {
        await dvFetch(token, 'POST', '/swank_employees', payload);
        created++;
        info(`Created: ${ce.empNum} ${ce.name}`);
      } catch (err) {
        info(`ERROR creating ${ce.empNum} ${ce.name}: ${err.message}`);
      }
    } else if (fieldsChanged(existing, payload)) {
      try {
        await dvFetch(token, 'PATCH', `/swank_employees(${existing.swank_employeeid})`, payload);
        updated++;
        info(`Updated: ${ce.empNum} ${ce.name}`);
      } catch (err) {
        info(`ERROR updating ${ce.empNum} ${ce.name}: ${err.message}`);
      }
    } else {
      unchanged++;
    }
  }

  for (const dvRow of dvRows) {
    if (dvRow.swank_empnum != null && !ceEmpNums.has(dvRow.swank_empnum) && dvRow.swank_active !== false) {
      try {
        await dvFetch(token, 'PATCH', `/swank_employees(${dvRow.swank_employeeid})`, { swank_active: false });
        deactivated++;
        info(`Marked inactive: ${dvRow.swank_empnum} ${dvRow.swank_name}`);
      } catch (err) {
        info(`ERROR deactivating ${dvRow.swank_empnum}: ${err.message}`);
      }
    }
  }

  info(`Sync complete: ${created} created, ${updated} updated, ${deactivated} marked inactive, ${unchanged} unchanged`);
  return { created, updated, deactivated, unchanged, log };
}

module.exports = { runSync };
