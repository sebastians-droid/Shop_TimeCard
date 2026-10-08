import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { collectSignInEmails, firstAllowlistedEmail, parseEmailList } = require('./sign-in-identity.js');
const { getUser } = require('./auth.js');

const allowlist = ['alisonh@swankco.com', 'bryank@swankco.com', 'sebastians@swankco.com'];

describe('parseEmailList', () => {
  it('splits commas, semicolons, and spaces and lowercases', () => {
    expect(parseEmailList(' AlisonH@swankco.com; BryanK@swankco.com nickl@swankco.com ')).toEqual([
      'alisonh@swankco.com',
      'bryank@swankco.com',
      'nickl@swankco.com',
    ]);
  });
});

describe('collectSignInEmails', () => {
  it('keeps the mailbox claim when userDetails is a display name', () => {
    const emails = collectSignInEmails({
      userDetails: 'Bryan K',
      claims: [
        { typ: 'name', val: 'Bryan K' },
        {
          typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
          val: 'BryanK@swankco.com',
        },
        { typ: 'preferred_username', val: 'Bryan.K@swankco.com' },
      ],
    });
    expect(emails).toContain('bryank@swankco.com');
    expect(emails).toContain('bryan.k@swankco.com');
    expect(firstAllowlistedEmail(emails, allowlist)).toBe('bryank@swankco.com');
  });

  it('recovers a mailbox from an Entra guest UPN', () => {
    const emails = collectSignInEmails({
      userDetails: 'sebastians_swankco.com#EXT#@contoso.onmicrosoft.com',
      claims: [],
    });
    expect(emails).toContain('sebastians@swankco.com');
    expect(firstAllowlistedEmail(emails, allowlist)).toBe('sebastians@swankco.com');
  });

  it('matches the allowlist when the UPN differs from the mail claim', () => {
    const emails = collectSignInEmails({
      userDetails: 'alison.h@swankco.com',
      claims: [{ typ: 'email', val: 'alisonh@swankco.com' }],
    });
    expect(firstAllowlistedEmail(emails, allowlist)).toBe('alisonh@swankco.com');
  });
});

describe('getUser', () => {
  it('treats the mail claim as the manager when userDetails is a display name', () => {
    const principal = Buffer.from(
      JSON.stringify({
        userId: 'aad-1',
        userDetails: 'Bryan K',
        claims: [
          { typ: 'name', val: 'Bryan K' },
          {
            typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            val: 'BryanK@swankco.com',
          },
        ],
      }),
    ).toString('base64');
    const user = getUser({
      headers: {
        get(name) {
          return name.toLowerCase() === 'x-ms-client-principal' ? principal : '';
        },
      },
    });
    expect(user.isManager).toBe(true);
    expect(user.email).toBe('bryank@swankco.com');
    expect(user.name).toBe('Bryan K');
  });
});
