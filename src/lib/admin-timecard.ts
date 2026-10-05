/** Fixed division and job for shop admin employees who do not work on assets. */
export const ADMIN_DIVISION = 200;
export const ADMIN_JOB_NUMBER = '112';

export function adminTimeEntryLabel(employeeName: string): string {
  return `${employeeName} - Division ${ADMIN_DIVISION} · Job ${ADMIN_JOB_NUMBER}`;
}

export function isAdminEmployee(
  employee: { isAdmin?: boolean } | null | undefined,
  user?: { isAdmin?: boolean } | null,
): boolean {
  return Boolean(employee?.isAdmin || user?.isAdmin);
}
