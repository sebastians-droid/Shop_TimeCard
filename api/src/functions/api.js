const { app } = require('@azure/functions');
const { handleRequest } = require('../../shared/handlers');

async function azureHandler(request) {
  try {
    return await handleRequest(request);
  } catch (error) {
    return {
      status: error.status || 500,
      jsonBody: { error: error.message || 'Unexpected error' },
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

app.http('employees', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: azureHandler,
});

app.http('employeesById', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'employees/{id}',
  handler: azureHandler,
});

app.http('lookupEmployees', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lookup-employees',
  handler: azureHandler,
});

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: azureHandler,
});

app.http('assets', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: azureHandler,
});

app.http('assetsById', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'assets/{id}',
  handler: azureHandler,
});

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: azureHandler,
});

app.http('speechToken', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'speech-token',
  handler: azureHandler,
});

app.http('timeEntries', {
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'time-entries/{id?}',
  handler: azureHandler,
});
