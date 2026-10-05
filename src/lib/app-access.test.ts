import { describe, expect, it } from 'vitest';

import type { AppUser } from '@/hooks/use-user';
import { isLinkedPersonalLogin, shouldShowEmployeeAccessGate, shouldShowEmployeeCodeSignIn } from '@/lib/app-access';

const josh: AppUser = {
  email: 'jbrezinski@swankco.com',
  name: 'Josh Brezinski',
  userId: '1',
  isManager: false,
  isKioskAccount: false,
  requiresEmployeeCode: false,
  canPunch: false,
  linkedPersonalLogin: true,
  shopEmployeeId: '9e7b4434-53a2-f111-b8da-70a8a59bea82',
};

const kiosk: AppUser = {
  email: 'shoptimecard@swankco.com',
  name: 'Shop kiosk',
  userId: '2',
  isManager: false,
  isKioskAccount: true,
  requiresEmployeeCode: true,
  canPunch: true,
  linkedPersonalLogin: false,
};

const unlinked: AppUser = {
  email: 'unknown@swankco.com',
  name: 'Unknown',
  userId: '3',
  isManager: false,
  isKioskAccount: false,
  requiresEmployeeCode: false,
  canPunch: false,
  linkedPersonalLogin: false,
};

describe('linked personal login (Josh / Gary style)', () => {
  it('recognizes a mechanic linked by company email', () => {
    expect(isLinkedPersonalLogin(josh)).toBe(true);
    expect(josh.canPunch).toBe(false);
    expect(josh.requiresEmployeeCode).toBe(false);
  });

  it('skips the employee code gate and access gate', () => {
    expect(shouldShowEmployeeCodeSignIn(josh, false, '')).toBe(false);
    expect(shouldShowEmployeeAccessGate(josh)).toBe(false);
  });

  it('still requires a code on the shared kiosk account', () => {
    expect(shouldShowEmployeeCodeSignIn(kiosk, false, '')).toBe(true);
    expect(isLinkedPersonalLogin(kiosk)).toBe(false);
  });

  it('shows the access gate when no employee row is linked', () => {
    expect(shouldShowEmployeeAccessGate(unlinked)).toBe(true);
    expect(shouldShowEmployeeCodeSignIn(unlinked, false, '')).toBe(false);
  });
});
