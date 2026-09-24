const {
  diagnose,
  getEmployeePhone,
  listEmployees,
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
  deleteTimeEntry,
} = require('./dataverse');
const { issueSpeechToken } = require('./speech');
const { requireUser, requireManager } = require('./auth');
const { sendSms } = require('./sms');
const { runSync } = require('./employee-sync');

function json(status, body) {
  return {
    status,
    jsonBody: body,
    headers: { 'Content-Type': 'application/json' },
  };
}

async function errorResponse(error) {
  let health;
  try {
    health = await diagnose();
  } catch (diagError) {
    health = { error: diagError.message || String(diagError) };
  }
  return json(error.status || 500, {
    error: error.message || 'Unexpected error',
    health,
  });
}

async function readJson(request) {
  try {
    if (typeof request.json === 'function') {
      return (await request.json()) || {};
    }
  } catch {
    // fall through
  }
  return {};
}

function apiPath(requestUrl) {
  const raw = String(requestUrl || '');
  let pathname = '/';
  try {
    pathname = new URL(raw, 'https://timecard.local').pathname;
  } catch {
    pathname = raw.split('?')[0] || '/';
  }
  pathname = pathname.replace(/\/$/, '') || '/';
  if (pathname === '/api' || pathname.startsWith('/api/')) return pathname;
  return `/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function handleRequest(request) {
  try {
    const pathname = apiPath(request.url);
    const method = (request.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return json(204, {});
    }
    if (method === 'GET' && pathname === '/api/health') {
      return json(200, await diagnose());
    }

    if (method === 'GET' && pathname === '/api/me') {
      const user = requireUser(request);
      return json(200, user);
    }

    if (method === 'GET' && (pathname === '/api/speech-token' || pathname === '/api/speechToken')) {
      requireUser(request);
      return json(200, await issueSpeechToken());
    }

    if (method === 'GET' && pathname === '/api/employees') {
      return json(200, { employees: await listEmployees() });
    }

    if (method === 'GET' && pathname === '/api/lookup-employees') {
      return json(200, { employees: await listLookupEmployees() });
    }

    if (method === 'GET' && pathname === '/api/assets') {
      return json(200, { assets: await listAssets() });
    }

    if (method === 'POST' && pathname === '/api/assets') {
      requireManager(request);
      const record = await readJson(request);
      return json(201, await createAsset(record));
    }

    const assetMatch = pathname.match(/^\/api\/assets\/([0-9a-f-]{36})$/i);
    if (assetMatch && method === 'PATCH') {
      requireManager(request);
      const record = await readJson(request);
      return json(200, await updateAsset(assetMatch[1], record));
    }

    if (assetMatch && method === 'DELETE') {
      requireManager(request);
      await deactivateAsset(assetMatch[1]);
      return json(204, {});
    }

    if (method === 'POST' && pathname === '/api/employees') {
      requireManager(request);
      const record = await readJson(request);
      return json(201, await createShopEmployee(record));
    }

    const employeeMatch = pathname.match(/^\/api\/employees\/([0-9a-f-]{36})$/i);
    if (employeeMatch && method === 'PATCH') {
      requireManager(request);
      const record = await readJson(request);
      return json(200, await updateShopEmployee(employeeMatch[1], record));
    }

    if (employeeMatch && method === 'DELETE') {
      requireManager(request);
      await deactivateShopEmployee(employeeMatch[1]);
      return json(204, {});
    }

    if (method === 'GET' && (pathname === '/api/time-entries' || pathname === '/api/timeEntries')) {
      requireUser(request);
      const url = new URL(request.url, 'https://timecard.local');
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      return json(200, { entries: await listTimeEntries({ from, to }) });
    }

    if (method === 'POST' && (pathname === '/api/time-entries' || pathname === '/api/timeEntries')) {
      requireUser(request);
      const record = await readJson(request);
      return json(201, await createTimeEntry(record));
    }

    const entryMatch = pathname.match(/^\/api\/time-entries\/([0-9a-f-]{36})$/i)
      || pathname.match(/^\/api\/timeEntries\/([0-9a-f-]{36})$/i);
    if (entryMatch && method === 'PATCH') {
      requireUser(request);
      const record = await readJson(request);
      const updated = await updateTimeEntry(entryMatch[1], record);

      if (record.ptoApproval === 'Approved' || record.ptoApproval === 'Denied') {
        const empId = updated.employee?.id;
        const empInfo = empId ? await getEmployeePhone(empId) : null;
        if (empInfo?.phone) {
          const status = record.ptoApproval === 'Approved' ? 'APPROVED' : 'DENIED';
          const date = updated.workDate || 'the requested date';
          const hours = updated.hours ?? '';
          const msg = `Swank Shop Hub: Your ${hours}h PTO request for ${date} has been ${status}.`;
          sendSms(empInfo.phone, msg).catch(() => {});
        }
      }

      return json(200, updated);
    }

    if (entryMatch && method === 'DELETE') {
      requireManager(request);
      await deleteTimeEntry(entryMatch[1]);
      return json(204, {});
    }

    if (method === 'POST' && pathname === '/api/employee-sync') {
      requireManager(request);
      const result = await runSync({ excelPath: process.env.SYNC_EXCEL_PATH || undefined });
      return json(200, result);
    }

    return json(404, { error: `Not found: ${method} ${pathname}` });
  } catch (error) {
    return await errorResponse(error);
  }
}

module.exports = { handleRequest };
