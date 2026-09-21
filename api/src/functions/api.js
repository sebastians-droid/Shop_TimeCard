const { app } = require('@azure/functions');
const { handleRequest } = require('../shared/handlers');

async function azureHandler(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    headers.set(key, value);
  }
  const url = request.url.startsWith('http') ? request.url : `https://timecard/${request.url.replace(/^\//, '')}`;
  const incoming = new Request(url, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
  });
  const result = await handleRequest(incoming);
  return {
    status: result.status,
    jsonBody: result.jsonBody,
    headers: result.headers,
  };
}

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: azureHandler,
});

app.http('employees', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'employees',
  handler: azureHandler,
});

app.http('assets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'assets',
  handler: azureHandler,
});

app.http('timeEntries', {
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'time-entries/{id?}',
  handler: azureHandler,
});
