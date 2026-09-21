const { loadConfig } = require('./dataverse');

function decodePrincipal(headerValue) {
  if (!headerValue) return null;
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getUser(request) {
  const principal = decodePrincipal(
    request.headers.get('x-ms-client-principal') || request.headers.get('X-MS-CLIENT-PRINCIPAL'),
  );
  const cfg = loadConfig();
  const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production' || Boolean(process.env.WEBSITE_SITE_NAME);
  const skipAuth = process.env.DATAVERSE_LOCAL_SKIP_AUTH === '1' || !isProduction;

  if (!principal) {
    if (!skipAuth) return null;
    const email = (process.env.DEV_USER_EMAIL || cfg.managerEmails[0] || 'local-dev@swankco.com').toLowerCase();
    return {
      userId: 'local-dev',
      email,
      name: process.env.DEV_USER_NAME || 'Local developer',
      isManager: cfg.managerEmails.length === 0 || cfg.managerEmails.includes(email),
    };
  }

  const claims = Object.fromEntries(
    (principal.claims || []).map((claim) => [claim.typ || claim.type, claim.val || claim.value]),
  );
  const email = (
    principal.userDetails ||
    claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
    claims.preferred_username ||
    ''
  ).toLowerCase();
  const name =
    claims.name ||
    claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
    email;

  return {
    userId: principal.userId || '',
    email,
    name,
    isManager: cfg.managerEmails.includes(email),
  };
}

function requireUser(request) {
  const user = getUser(request);
  if (!user) {
    const error = new Error('Sign in with Microsoft 365 to use Shop Timecard.');
    error.status = 401;
    throw error;
  }
  return user;
}

function requireManager(request) {
  const user = requireUser(request);
  if (!user.isManager) {
    const error = new Error('Manager access is required for this action.');
    error.status = 403;
    throw error;
  }
  return user;
}

module.exports = { getUser, requireUser, requireManager };
