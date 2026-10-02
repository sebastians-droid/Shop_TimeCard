const { loadConfig, findShopEmployeeBySignInEmail, getTimeEntryEmployeeId } = require('./dataverse');

function decodePrincipal(headerValue) {
  if (!headerValue) return null;
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function headerGet(request, name) {
  if (!request?.headers) return '';
  if (typeof request.headers.get === 'function') {
    return request.headers.get(name) || request.headers.get(name.toLowerCase()) || '';
  }
  return request.headers[name] || request.headers[name.toLowerCase()] || '';
}

function getUser(request) {
  const principal = decodePrincipal(headerGet(request, 'x-ms-client-principal') || headerGet(request, 'X-MS-CLIENT-PRINCIPAL'));
  const cfg = loadConfig();
  const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production' || Boolean(process.env.WEBSITE_SITE_NAME);
  const skipAuth = process.env.DATAVERSE_LOCAL_SKIP_AUTH === '1' || !isProduction;

  if (!principal) {
    const headerEmail = (headerGet(request, 'x-ms-client-principal-name') || request.user?.username || '').toLowerCase();
    if (headerEmail) {
      return {
        userId: headerGet(request, 'x-ms-client-principal-id') || request.user?.id || '',
        email: headerEmail,
        name: headerEmail,
        isManager: cfg.managerEmails.includes(headerEmail),
      };
    }
    if (!skipAuth) return null;
    const email = (process.env.DEV_USER_EMAIL || cfg.managerEmails[0] || 'local-dev@swankco.com').toLowerCase();
    return {
      userId: 'local-dev',
      email,
      name: process.env.DEV_USER_NAME || 'Local developer',
      isManager: cfg.managerEmails.length === 0 || cfg.managerEmails.includes(email),
    };
  }

  const claims = Object.fromEntries((principal.claims || []).map((claim) => [claim.typ || claim.type, claim.val || claim.value]));
  const email = (
    principal.userDetails ||
    claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
    claims.preferred_username ||
    ''
  ).toLowerCase();
  const name = claims.name || claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] || email;

  return {
    userId: principal.userId || '',
    email,
    name,
    isManager: cfg.managerEmails.includes(email),
  };
}

function recordTouchesPunch(record) {
  if (!record || typeof record !== 'object') return false;
  return record.clockIn !== undefined || record.clockOut !== undefined;
}

async function resolveAppUser(request) {
  const base = getUser(request);
  if (!base) return null;

  const cfg = loadConfig();
  const email = base.email.toLowerCase();
  const isKioskAccount = cfg.kioskEmails.includes(email);
  let shopEmployee = null;

  if (!isKioskAccount) {
    try {
      shopEmployee = await findShopEmployeeBySignInEmail(email);
    } catch {
      shopEmployee = null;
    }
  }

  const isRoadMech = shopEmployee?.isRoadMech === true;
  const canPunch = isKioskAccount || isRoadMech;
  const requiresEmployeeCode = isKioskAccount;

  return {
    ...base,
    isKioskAccount,
    requiresEmployeeCode,
    canPunch,
    shopEmployeeId: shopEmployee?.id || undefined,
    isRoadMech: isRoadMech || undefined,
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

async function requireAppUser(request) {
  const user = await resolveAppUser(request);
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

function assertOwnShopEmployee(user, employeeId) {
  if (user.isManager || user.isKioskAccount) return;
  if (!employeeId || !user.shopEmployeeId || employeeId !== user.shopEmployeeId) {
    const error = new Error('You can only change your own timecard entries.');
    error.status = 403;
    throw error;
  }
}

async function assertTimeEntryAccess(user, entryId, changedFields = {}) {
  if (user.isManager || user.isKioskAccount) return;
  const employeeId = await getTimeEntryEmployeeId(entryId);
  assertOwnShopEmployee(user, employeeId);
  if (recordTouchesPunch(changedFields) && !user.canPunch) {
    const error = new Error('Clock in and clock out are only allowed from the shop kiosk or a road mechanic account.');
    error.status = 403;
    throw error;
  }
}

function assertPunchCreate(user, record) {
  if (!recordTouchesPunch(record)) return;
  if (!user.canPunch) {
    const error = new Error('Clock in and clock out are only allowed from the shop kiosk or a road mechanic account.');
    error.status = 403;
    throw error;
  }
  assertOwnShopEmployee(user, record.employee?.id);
}

module.exports = {
  getUser,
  resolveAppUser,
  requireUser,
  requireAppUser,
  requireManager,
  assertTimeEntryAccess,
  assertPunchCreate,
  recordTouchesPunch,
};
