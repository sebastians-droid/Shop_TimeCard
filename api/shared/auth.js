const { loadConfig, findShopEmployeeBySignInEmail, getTimeEntryPunch, listEmployeeTimeEntries } = require('./dataverse');
const { collectSignInEmails, firstAllowlistedEmail } = require('./sign-in-identity');

const PUNCH_DENIED_MESSAGE = 'Clock in and clock out happen at the shop kiosk. Once you are clocked in, you can add jobs from any device.';
const OUTSIDE_DAY_MESSAGE =
  "Job times must fall inside a time you were clocked in at the shop kiosk, not across a break. Ask a manager to change the day's clock-in or clock-out.";
// A job switch is stamped by the client; this bounds how far that stamp may drift from the server clock.
const SWITCH_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DAY_LOOKAROUND_MS = 36 * 60 * 60 * 1000;
const SAME_DAY_FALLBACK_MS = 14 * 60 * 60 * 1000;
// Matches BREAK_MIN_GAP_MS in src/lib/time-rules.ts: shorter gaps between punches are drift, not a break.
const BREAK_MIN_GAP_MS = 5 * 60 * 1000;

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

function claimValue(principal, ...types) {
  const wanted = new Set(types);
  for (const claim of principal?.claims || []) {
    const type = claim.typ || claim.type || '';
    if (!wanted.has(type)) continue;
    const value = claim.val ?? claim.value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function identityFromEmails(emails, cfg, { userId = '', name = '' } = {}) {
  const allowlisted = firstAllowlistedEmail(emails, cfg.managerEmails);
  const email = allowlisted || emails[0] || '';
  return {
    userId,
    email,
    emails,
    name: name || email,
    isManager: Boolean(allowlisted),
  };
}

function getUser(request) {
  const principal = decodePrincipal(headerGet(request, 'x-ms-client-principal') || headerGet(request, 'X-MS-CLIENT-PRINCIPAL'));
  const cfg = loadConfig();
  const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production' || Boolean(process.env.WEBSITE_SITE_NAME);
  const skipAuth = process.env.DATAVERSE_LOCAL_SKIP_AUTH === '1' || !isProduction;

  if (!principal) {
    const headerEmail = headerGet(request, 'x-ms-client-principal-name') || request.user?.username || '';
    const emails = collectSignInEmails(null, headerEmail);
    if (emails.length > 0 || headerEmail.trim()) {
      const identity = identityFromEmails(emails, cfg, {
        userId: headerGet(request, 'x-ms-client-principal-id') || request.user?.id || '',
      });
      if (!identity.email && headerEmail.trim()) {
        identity.email = headerEmail.trim();
        identity.name = headerEmail.trim();
      }
      return identity;
    }
    if (!skipAuth) return null;
    const email = (process.env.DEV_USER_EMAIL || cfg.managerEmails[0] || 'local-dev@swankco.com').toLowerCase();
    return {
      userId: 'local-dev',
      email,
      emails: [email],
      name: process.env.DEV_USER_NAME || 'Local developer',
      isManager: cfg.managerEmails.length === 0 || cfg.managerEmails.includes(email),
    };
  }

  const emails = collectSignInEmails(principal);
  const name =
    claimValue(principal, 'name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name') ||
    (principal.userDetails && !principal.userDetails.includes('@') ? principal.userDetails : '');

  return identityFromEmails(emails, cfg, { userId: principal.userId || '', name });
}

function recordTouchesPunch(record) {
  if (!record || typeof record !== 'object') return false;
  return record.clockIn !== undefined || record.clockOut !== undefined;
}

async function resolveAppUser(request) {
  const base = getUser(request);
  if (!base) return null;

  const cfg = loadConfig();
  const emails = base.emails?.length ? base.emails : base.email ? [base.email.toLowerCase()] : [];
  const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production' || Boolean(process.env.WEBSITE_SITE_NAME);
  const skipAuth = process.env.DATAVERSE_LOCAL_SKIP_AUTH === '1' || !isProduction;
  // Local demo has no kiosk account configured yet — keep the employee-code
  // punch flow working until KIOSK_EMAILS is set.
  const isKioskAccount = emails.some((email) => cfg.kioskEmails.includes(email)) || (skipAuth && cfg.kioskEmails.length === 0);
  let shopEmployee = null;

  if (!isKioskAccount) {
    for (const email of emails) {
      try {
        shopEmployee = await findShopEmployeeBySignInEmail(email);
      } catch {
        shopEmployee = null;
      }
      if (shopEmployee) break;
    }
  }

  const isRoadMech = shopEmployee?.isRoadMech === true;
  const isAdmin = shopEmployee?.isAdmin === true;
  const canPunch = base.isManager || isKioskAccount || isRoadMech || isAdmin;
  const requiresEmployeeCode = isKioskAccount;
  // Work M365 login matched to Company Email on Employee — timecard opens directly
  // on phone with no kiosk code and no idle sign-out; punch stays at the kiosk.
  const linkedPersonalLogin = Boolean(shopEmployee?.id && !isKioskAccount);

  const publicUser = { ...base };
  delete publicUser.emails;

  return {
    ...publicUser,
    isKioskAccount,
    requiresEmployeeCode,
    canPunch,
    linkedPersonalLogin,
    shopEmployeeId: shopEmployee?.id || undefined,
    isRoadMech: isRoadMech || undefined,
    isAdmin: isAdmin || undefined,
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
 * The spans an employee was actually on the clock on a work day, with breaks
 * between clock-out and the next clock-in left out. An open punch runs to now.
 * Empty when nothing was punched.
 */
async function punchedDaySessions(employeeId, anchorIso, workDate) {
  const anchor = new Date(anchorIso).getTime();
  if (!Number.isFinite(anchor)) return [];
  const entries = await listEmployeeTimeEntries(employeeId, {
    from: new Date(anchor - DAY_LOOKAROUND_MS).toISOString(),
    to: new Date(anchor + DAY_LOOKAROUND_MS).toISOString(),
  });
  const day = entries.filter((entry) => {
    if (!entry.clockIn || isPtoRecord(entry)) return false;
    if (workDate && entry.workDate) return sameWorkDate(entry.workDate, workDate);
    return Math.abs(new Date(entry.clockIn).getTime() - anchor) <= SAME_DAY_FALLBACK_MS;
  });
  const now = Date.now();
  const sessions = [];
  const spans = day
    .map((entry) => ({ start: new Date(entry.clockIn).getTime(), end: entry.clockOut ? new Date(entry.clockOut).getTime() : now }))
    .sort((a, b) => a.start - b.start);
  for (const span of spans) {
    const last = sessions[sessions.length - 1];
    if (last && span.start - last.end < BREAK_MIN_GAP_MS) last.end = Math.max(last.end, span.end);
    else sessions.push({ ...span });
  }
  return sessions;
}

async function assertTimesInsidePunchedDay(employeeId, times, workDate) {
  const values = times.filter(Boolean);
  if (values.length === 0) return;
  const sessions = await punchedDaySessions(employeeId, values[0], workDate);
  if (sessions.length === 0) throw forbidden(PUNCH_DENIED_MESSAGE);
  const stamps = values.map((value) => new Date(value).getTime());
  const inside = sessions.some((session) => stamps.every((time) => Number.isFinite(time) && time >= session.start && time <= session.end));
  if (!inside) throw forbidden(OUTSIDE_DAY_MESSAGE);
}

/**
 * Closing an open punch is always allowed for the employee who owns it.
 * A row left open overnight must still be closable from the kiosk or that
 * employee's phone. Changing clock-in, reopening a closed punch, or editing
 * an already-written clock-out stays on the normal punch rules.
 */
function isClosingOpenPunch(existing, changedFields) {
  return Boolean(changedFields.clockOut) && !existing.clockOut && changedFields.clockIn === undefined;
}

function assertCanClockOut(user, employeeId) {
  if (hasFullTimecardAccess(user)) return;
  assertOwnShopEmployee(user, employeeId);
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
  if (isClosingOpenPunch(existing, changedFields)) return;
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
  assertCanClockOut,
  recordTouchesPunch,
};
