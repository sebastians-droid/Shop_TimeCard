import { scheduledStartFor, type EmployeePayProfile } from '@/lib/time-rules';

type ScheduleRow = { employeeId?: string; scheduleDate: string; scheduledStart?: string };

/** One employee's stored scheduled starts, keyed by work date (yyyy-MM-dd). */
export function scheduledStartsByDay(rows: ScheduleRow[], employeeId: string | undefined): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const row of rows) {
    if (employeeId && row.employeeId === employeeId && row.scheduleDate) map.set(row.scheduleDate.slice(0, 10), row.scheduledStart);
  }
  return map;
}

/** The pay start every total uses: the day's stored start, or clock-in for road and admin staff. */
export function payStartForDay(
  employee: EmployeePayProfile | null | undefined,
  rows: ScheduleRow[],
  employeeId: string | undefined,
  dateKey: string,
): string | null | undefined {
  return scheduledStartFor(employee, scheduledStartsByDay(rows, employeeId).get(dateKey));
}
