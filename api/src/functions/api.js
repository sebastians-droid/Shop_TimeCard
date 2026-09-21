const { app } = require('@azure/functions');
const { handleRequest } = require('../shared/handlers');

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

app.http('api', {
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: azureHandler,
});
