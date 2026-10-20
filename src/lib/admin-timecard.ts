/** Fixed division and job for admin staff and parts runners who do not work on assets. */
export const ADMIN_DIVISION = 200;
export const ADMIN_JOB_NUMBER = '112';
export const PARTS_RUNNER_JOB_NUMBER = '113';

export function adminTimeEntryLabel(employeeName: string): string {
  return `${employeeName} - Division ${ADMIN_DIVISION} · Job ${ADMIN_JOB_NUMBER}`;
}

/** Job 112 for admin; job 113 for parts runners. */
export function clockInOnlyJobNumber(
  employee: { isAdmin?: boolean; isPartsRunner?: boolean } | null | undefined,
  user?: { isAdmin?: boolean; isPartsRunner?: boolean } | null,
): string {
  if (isPartsRunnerEmployee(employee, user) && !isAdminEmployee(employee, user)) {
    return PARTS_RUNNER_JOB_NUMBER;
  }
  return ADMIN_JOB_NUMBER;
}

export function clockInOnlyTimeEntryLabel(
  employeeName: string,
  employee: { isAdmin?: boolean; isPartsRunner?: boolean } | null | undefined,
  user?: { isAdmin?: boolean; isPartsRunner?: boolean } | null,
): string {
  const job = clockInOnlyJobNumber(employee, user);
  return `${employeeName} - Division ${ADMIN_DIVISION} · Job ${job}`;
}

export function clockInOnlyDivisionJobCaption(
  employee: { isAdmin?: boolean; isPartsRunner?: boolean } | null | undefined,
  user?: { isAdmin?: boolean; isPartsRunner?: boolean } | null,
): string {
  return `Division ${ADMIN_DIVISION} · Job ${clockInOnlyJobNumber(employee, user)}`;
}

export function isAdminEmployee(
  employee: { isAdmin?: boolean } | null | undefined,
  user?: { isAdmin?: boolean } | null,
): boolean {
  return Boolean(employee?.isAdmin || user?.isAdmin);
}

export function isPartsRunnerEmployee(
  employee: { isPartsRunner?: boolean } | null | undefined,
  user?: { isPartsRunner?: boolean } | null,
): boolean {
  return Boolean(employee?.isPartsRunner || user?.isPartsRunner);
}

/** Clock-in/out only on a fixed division/job — no asset switching. */
export function usesClockInOnlyTimecard(
  employee: { isAdmin?: boolean; isPartsRunner?: boolean } | null | undefined,
  user?: { isAdmin?: boolean; isPartsRunner?: boolean } | null,
): boolean {
  return isAdminEmployee(employee, user) || isPartsRunnerEmployee(employee, user);
}
