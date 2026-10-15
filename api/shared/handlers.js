const {
  diagnose,
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
  closeOpenPunches,
  applyAutoClockOuts,
  autoCloseExpiredPunches,
  deleteTimeEntry,
  getTimeEntryPunch,
  listSchedules,
  upsertSchedule,
} = require('./dataverse');
const { issueSpeechToken } = require('./speech');
const {
  requireUser,
  requireAppUser,
  requireManager,
  assertTimeEntryAccess,
  assertTimeEntryCreate,
  assertJobSwitch,
  assertCanClockOut,
} = require('./auth');
let runSync = async () => {
  throw new Error('Sync module not loaded');
};
try {
  ({ runSync } = require('./employee-sync'));
} catch {
  /* Sync optional */
}

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

function clientIp(request) {
  const forwarded = request.headers?.get?.('x-forwarded-for') || request.headers?.['x-forwarded-for'] || '';
  const first = String(forwarded).split(',')[0].trim();
  return first || undefined;
}

function apiPath(requestUrl) {
  const raw = String(requestUrl || '');
  let pathname;
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
      const user = await requireAppUser(request);
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
      const entries = await applyAutoClockOuts(await listTimeEntries({ from, to }));
      return json(200, { entries });
    }

    if (method === 'POST' && (pathname === '/api/time-entries' || pathname === '/api/timeEntries')) {
      const user = await requireAppUser(request);
      const record = await readJson(request);
      await assertTimeEntryCreate(user, record);
      if (record.employee?.id) await autoCloseExpiredPunches(record.employee.id);
      const ip = clientIp(request);
      if (ip && record.clockIn) record.clockInIp = ip;
      return json(201, await createTimeEntry(record));
    }

    if (method === 'POST' && pathname === '/api/time-entries/clock-out') {
      const user = await requireAppUser(request);
      const body = await readJson(request);
      const employeeId = body.employeeId;
      if (!employeeId) {
        const error = new Error('Choose an employee before clocking out.');
        error.status = 400;
        throw error;
      }
      assertCanClockOut(user, employeeId);
      const ip = clientIp(request);
      const result = await closeOpenPunches(employeeId, {
        clockOut: body.clockOut,
        lat: body.lat,
        lon: body.lon,
        ip,
        entries: Array.isArray(body.entries) ? body.entries : [],
      });
      return json(200, result);
    }

    const switchMatch = pathname.match(/^\/api\/time-entries\/([0-9a-f-]{36})\/switch-job$/i);
    if (switchMatch && method === 'POST') {
      const user = await requireAppUser(request);
      const body = await readJson(request);
      const next = { ...(body.next || {}) };
      const switchAt = body.switchAt;
      const active = await getTimeEntryPunch(switchMatch[1]);
      await assertJobSwitch(user, active, next, switchAt);
      const ip = clientIp(request);
      const closed = await updateTimeEntry(active.id, {
        clockOut: switchAt,
        hours: body.closingHours,
        clockOutLat: body.lat,
        clockOutLon: body.lon,
        clockOutIp: ip,
      });
      delete next.clockOut;
      next.clockIn = switchAt;
      // A switch after midnight is still the same shift, so it stays on the day that shift started.
      if (active.workDate) next.workDate = String(active.workDate).slice(0, 10);
      next.clockInLat = body.lat;
      next.clockInLon = body.lon;
      if (ip) next.clockInIp = ip;
      try {
        const created = await createTimeEntry(next);
        return json(201, { closed, created });
      } catch (createError) {
        await updateTimeEntry(active.id, { clockOut: '', hours: active.hours ?? null }).catch(() => undefined);
        throw createError;
      }
    }

    const entryMatch =
      pathname.match(/^\/api\/time-entries\/([0-9a-f-]{36})$/i) || pathname.match(/^\/api\/timeEntries\/([0-9a-f-]{36})$/i);
    if (entryMatch && method === 'PATCH') {
      const user = await requireAppUser(request);
      const record = await readJson(request);
      await assertTimeEntryAccess(user, entryMatch[1], record);
      const ip = clientIp(request);
      if (ip && record.clockOut) record.clockOutIp = ip;
      return json(200, await updateTimeEntry(entryMatch[1], record));
    }

    if (entryMatch && method === 'DELETE') {
      requireManager(request);
      await deleteTimeEntry(entryMatch[1]);
      return json(204, {});
    }

    if (method === 'GET' && pathname === '/api/schedules') {
      requireManager(request);
      const url = new URL(request.url, 'https://timecard.local');
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      return json(200, { schedules: await listSchedules({ from, to }) });
    }

    if (method === 'PATCH' && pathname === '/api/schedules') {
      requireManager(request);
      const record = await readJson(request);
      return json(200, await upsertSchedule(record));
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
