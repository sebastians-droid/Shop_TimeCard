const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function parseEmailList(value) {
  if (!value) return [];
  return [
    ...new Set(
      String(value)
        .split(/[,;\s]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes('@')),
    ),
  ];
}

/** Guest UPNs look like local_domain.com#EXT#@tenant.onmicrosoft.com. */
function emailFromGuestUpn(value) {
  const match = String(value).trim().match(/^(.+?)#ext#@/i);
  if (!match) return '';
  const localAndDomain = match[1];
  const splitAt = localAndDomain.lastIndexOf('_');
  if (splitAt <= 0) return '';
  return `${localAndDomain.slice(0, splitAt)}@${localAndDomain.slice(splitAt + 1)}`.toLowerCase();
}

function addEmails(found, value) {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (!text) return;
  const guest = emailFromGuestUpn(text);
  if (guest) found.add(guest);
  const matches = text.match(EMAIL_PATTERN);
  if (matches) {
    for (const email of matches) found.add(email.toLowerCase());
  }
}

/**
 * Every address Microsoft may put on the sign-in: userDetails (often the UPN),
 * mail, preferred_username, and guest UPNs. Allowlist checks must see all of them.
 */
function collectSignInEmails(principal, extra = '') {
  const found = new Set();
  addEmails(found, extra);
  if (!principal) return [...found];
  addEmails(found, principal.userDetails);
  addEmails(found, principal.userId);
  for (const claim of principal.claims || []) {
    addEmails(found, claim.val ?? claim.value);
  }
  return [...found];
}

function firstAllowlistedEmail(emails, allowlist) {
  const allowed = new Set((allowlist || []).map((email) => String(email).trim().toLowerCase()));
  return emails.find((email) => allowed.has(email)) || '';
}

module.exports = {
  parseEmailList,
  collectSignInEmails,
  firstAllowlistedEmail,
};
