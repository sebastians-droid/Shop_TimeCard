const { loadConfig, findShopEmployeeBySignInEmail, getTimeEntryPunch, listEmployeeTimeEntries } = require('./dataverse');

const PUNCH_DENIED_MESSAGE =
  'Clock in and clock out happen at the shop kiosk. Once you are clocked in, you can add jobs from any device.';
const OUTSIDE_DAY_MESSAGE =
  "Job times must fall inside a day you clocked in for at the shop kiosk. Ask a manager to change the day's clock-in or clock-out.";
// A job switch is stamped by the client; this bounds how far that stamp may drift from the server clock.
const SWITCH_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DAY_LOOKAROUND_MS = 36 * 60 * 60 * 1000;
const SAME_DAY_FALLBACK_MS = 14 * 60 * 60 * 1000;

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
  const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production' || Boolean(process.env.WEBSITE_SITE_NAME);
  const skipAuth = process.env.DATAVERSE_LOCAL_SKIP_AUTH === '1' || !isProduction;
  // Local demo has no kiosk account configured yet — keep the employee-code
  // punch flow working until KIOSK_EMAILS is set.
  const isKioskAccount = cfg.kioskEmails.includes(email) || (skipAuth && cfg.kioskEmails.length === 0);
  let shopEmployee = null;

  if (!isKioskAccount) {
    try {
      shopEmployee = await findShopEmployeeBySignInEmail(email);
    } catch {
      shopEmployee = null;
    }
  }

  const isRoadMech = shopEmployee?.isRoadMech === true;
  const canPunch = base.isManager || isKioskAccount || isRoadMech;
  const requiresEmployeeCode = isKioskAccount;
  // Work M365 login matched to Company Email on Employee — timecard opens directly
  // on phone with no kiosk code and no idle sign-out; punch stays at the kiosk.
  const linkedPersonalLogin = Boolean(shopEmployee?.id && !isKioskAccount);

  return {
    ...base,
    isKioskAccount,
    requiresEmployeeCode,
    canPunch,
    linkedPersonalLogin,
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

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

/** Managers and the shop kiosk act for any employee and may change any time. */
function hasFullTimecardAccess(user) {
  return Boolean(user.isManager || user.isKioskAccount);
}

function assertOwnShopEmployee(user, employeeId) {
  if (hasFullTimecardAccess(user)) return;
  if (!employeeId || !user.shopEmployeeId || employeeId !== user.shopEmployeeId) {
    throw forbidden('You can only change your own timecard entries.');
  }
}

function isPtoRecord(record) {
  return Boolean(record?.pTOTimeKey) || record?.jobNumber === 'PTO';
}

function assertPtoApproval(user, record) {
  if (user.isManager || record.ptoApproval === undefined || record.ptoApproval === 'Pending') return;
  throw forbidden('Only a manager can approve or reject PTO.');
}

function sameWorkDate(a, b) {
  return Boolean(a && b) && String(a).slice(0, 10) === String(b).slice(0, 10);
}

/**
 * The span an employee actually punched on a work day: first clock-in to last
 * clock-out, or to now while still clocked in. Null when nothing was punched.
 */
async function punchedDayWindow(employeeId, anchorIso, workDate) {
  const anchor = new Date(anchorIso).getTime();
  if (!Number.isFinite(anchor)) return null;
  const entries = await listEmployeeTimeEntries(employeeId, {
    from: new Date(anchor - DAY_LOOKAROUND_MS).toISOString(),
    to: new Date(anchor + DAY_LOOKAROUND_MS).toISOString(),
  });
  const day = entries.filter((entry) => {
    if (!entry.clockIn || isPtoRecord(entry)) return false;
    if (workDate && entry.workDate) return sameWorkDate(entry.workDate, workDate);
    return Math.abs(new Date(entry.clockIn).getTime() - anchor) <= SAME_DAY_FALLBACK_MS;
  });
  if (day.length === 0) return null;
  const now = Date.now();
  return {
    start: Math.min(...day.map((entry) => new Date(entry.clockIn).getTime())),
    end: Math.max(...day.map((entry) => (entry.clockOut ? new Date(entry.clockOut).getTime() : now))),
  };
}

async function assertTimesInsidePunchedDay(employeeId, times, workDate) {
  const values = times.filter(Boolean);
  if (values.length === 0) return;
  const window = await punchedDayWindow(employeeId, values[0], workDate);
  if (!window) throw forbidden(PUNCH_DENIED_MESSAGE);
  for (const value of values) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time < window.start || time > window.end) throw forbidden(OUTSIDE_DAY_MESSAGE);
  }
}

/**
 * Employees on their own device may add or reshape jobs inside a day already
 * punched at the kiosk, but cannot start, end, or reopen that day themselves.
 */
async function assertTimeEntryCreate(user, record) {
  assertPtoApproval(user, record);
  if (hasFullTimecardAccess(user)) return;
  assertOwnShopEmployee(user, record.employee?.id);
  if (!recordTouchesPunch(record) || isPtoRecord(record) || user.canPunch) return;
  if (!record.clockIn || !record.clockOut) throw forbidden(PUNCH_DENIED_MESSAGE);
  await assertTimesInsidePunchedDay(record.employee.id, [record.clockIn, record.clockOut], record.workDate);
}

async function assertTimeEntryAccess(user, entryId, changedFields = {}) {
  assertPtoApproval(user, changedFields);
  if (hasFullTimecardAccess(user)) return;
  const existing = await getTimeEntryPunch(entryId);
  assertOwnShopEmployee(user, existing.employeeId);
  if (!recordTouchesPunch(changedFields) || user.canPunch) return;
  if (changedFields.clockOut !== undefined && (!existing.clockOut || !changedFields.clockOut)) {
    throw forbidden(PUNCH_DENIED_MESSAGE);
  }
  if (changedFields.clockIn !== undefined && !changedFields.clockIn) throw forbidden(PUNCH_DENIED_MESSAGE);
  await assertTimesInsidePunchedDay(existing.employeeId, [changedFields.clockIn, changedFields.clockOut], existing.workDate);
}

/**
 * Closing the running job and starting the next one is a single step, so a
 * clocked-in employee can change jobs from any device without that close
 * counting as a clock-out.
 */
async function assertJobSwitch(user, active, next, switchAt) {
  assertPtoApproval(user, next);
  if (active.clockOut) {
    const error = new Error('That job was already closed. Reload the timecard and try again.');
    error.status = 409;
    throw error;
  }
  if (next.employee?.id !== active.employeeId) throw forbidden('The next job must belong to the same employee.');
  const at = new Date(switchAt).getTime();
  if (!Number.isFinite(at) || at < new Date(active.clockIn).getTime()) {
    const error = new Error('The job switch time must be after the current job started.');
    error.status = 400;
    throw error;
  }
  if (hasFullTimecardAccess(user)) return;
  assertOwnShopEmployee(user, active.employeeId);
  if (!user.canPunch && Math.abs(at - Date.now()) > SWITCH_CLOCK_SKEW_MS) {
    throw forbidden('Your device clock is off. Fix the time on this device and try again.');
  }
}

module.exports = {
  getUser,
  resolveAppUser,
  requireUser,
  requireAppUser,
  requireManager,
  assertTimeEntryAccess,
  assertTimeEntryCreate,
  assertJobSwitch,
  recordTouchesPunch,
};
