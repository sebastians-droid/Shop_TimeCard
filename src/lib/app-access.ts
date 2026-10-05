import type { AppUser } from '@/hooks/use-user';

/**
 * Signed in with a work Microsoft 365 address that matches Company Email on the
 * mechanic's Employee row. Opens their timecard directly — no kiosk code, no
 * idle sign-out — but clock in/out still happens at the shop kiosk.
 */
export function isLinkedPersonalLogin(user: Pick<AppUser, 'linkedPersonalLogin'> | undefined): boolean {
  return Boolean(user?.linkedPersonalLogin);
}

/** No Shop Employee row matches the signed-in work address. */
export function shouldShowEmployeeAccessGate(user: AppUser | undefined): boolean {
  return Boolean(user && !user.requiresEmployeeCode && !user.linkedPersonalLogin && !user.isManager);
}

/** Shared shop kiosk account before an employee code is entered. */
export function shouldShowEmployeeCodeSignIn(
  user: AppUser | undefined,
  userLoading: boolean,
  selectedEmployeeId: string,
): boolean {
  if (userLoading || selectedEmployeeId) return false;
  if (isLinkedPersonalLogin(user)) return false;
  if (shouldShowEmployeeAccessGate(user)) return false;
  return Boolean(user);
}
