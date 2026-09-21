const {
  listEmployees,
  listAssets,
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} = require('./dataverse');
const { requireUser, requireManager } = require('./auth');

function json(status, body) {
  return {
    status,
    jsonBody: body,
    headers: { 'Content-Type': 'application/json' },
  };
}

function errorResponse(error) {
  const status = error.status || 500;
  return json(status, { error: error.message || 'Unexpected error' });
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  try {
    if (method === 'GET' && pathname === '/api/me') {
      const user = requireUser(request);
      return json(200, user);
    }

    if (method === 'GET' && pathname === '/api/employees') {
      requireUser(request);
      return json(200, { employees: await listEmployees() });
    }

    if (method === 'GET' && pathname === '/api/assets') {
      requireUser(request);
      return json(200, { assets: await listAssets() });
    }

    if (method === 'GET' && pathname === '/api/time-entries') {
      requireUser(request);
      return json(200, { entries: await listTimeEntries() });
    }

    if (method === 'POST' && pathname === '/api/time-entries') {
      requireUser(request);
      const record = await readJson(request);
      return json(201, await createTimeEntry(record));
    }

    const entryMatch = pathname.match(/^\/api\/time-entries\/([0-9a-f-]{36})$/i);
    if (entryMatch && method === 'PATCH') {
      requireUser(request);
      const record = await readJson(request);
      return json(200, await updateTimeEntry(entryMatch[1], record));
    }

    if (entryMatch && method === 'DELETE') {
      requireManager(request);
      await deleteTimeEntry(entryMatch[1]);
      return json(204, {});
    }

    return json(404, { error: 'Not found' });
  } catch (error) {
    return errorResponse(error);
  }
}

module.exports = { handleRequest };
