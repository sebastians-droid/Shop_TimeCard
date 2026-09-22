const {
  diagnose,
  listEmployees,
  listAssets,
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} = require('./dataverse');
const { issueSpeechToken } = require('./speech');
const { requireUser, requireManager } = require('./auth');

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

    if (method === 'GET' && pathname === '/api/assets') {
      return json(200, { assets: await listAssets() });
    }

    if (method === 'GET' && (pathname === '/api/time-entries' || pathname === '/api/timeEntries')) {
      return json(200, { entries: await listTimeEntries() });
    }

    if (method === 'POST' && (pathname === '/api/time-entries' || pathname === '/api/timeEntries')) {
      const record = await readJson(request);
      return json(201, await createTimeEntry(record));
    }

    const entryMatch = pathname.match(/^\/api\/time-entries\/([0-9a-f-]{36})$/i)
      || pathname.match(/^\/api\/timeEntries\/([0-9a-f-]{36})$/i);
    if (entryMatch && method === 'PATCH') {
      const record = await readJson(request);
      return json(200, await updateTimeEntry(entryMatch[1], record));
    }

    if (entryMatch && method === 'DELETE') {
      requireManager(request);
      await deleteTimeEntry(entryMatch[1]);
      return json(204, {});
    }

    return json(404, { error: `Not found: ${method} ${pathname}` });
  } catch (error) {
    return await errorResponse(error);
  }
}

module.exports = { handleRequest };
