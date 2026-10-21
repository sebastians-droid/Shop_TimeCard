import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { getEntryEmployeeKey } from '@/lib/entry-helpers';
import { payStartForDay, scheduledStartsByDay } from '@/lib/schedule-starts';
import { entryWorkDateKey, getDayPayMinutes, scheduledStartFor, type EmployeePayProfile } from '@/lib/time-rules';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0).toISOString();
}

const SHOP = 'emp-shop';
const OTHER = 'emp-other';
const DAY1 = '2026-03-09';
const DAY2 = '2026-03-10';
const DAY3 = '2026-03-11';
const NOW = new Date(2026, 2, 12, 12, 0);

const job = (id: string, employeeId: string, day: string, from: string, to: string): ShopTimeEntry => ({
  id,
  timeEntry: `Mechanic - Job ${id}`,
  employee: { id: employeeId, autoNumber: employeeId },
  jobNumber: `J-${id}`,
  clockIn: at(day, from),
  clockOut: at(day, to),
  workDate: day,
});

const entries: ShopTimeEntry[] = [
  job('a', SHOP, DAY1, '05:45', '14:30'), // scheduled 06:00 → paid from 06:00
  job('b', SHOP, DAY2, '06:10', '15:00'), // no stored start → paid from 07:00
  job('c', SHOP, DAY3, '06:20', '15:00'), // scheduled 06:00, clocked in later → paid from 06:20
  job('d', OTHER, DAY2, '05:30', '14:00'), // another employee's 05:30 start must not leak in
];

const schedules = [
  { employeeId: SHOP, scheduleDate: `${DAY1}T00:00:00Z`, scheduledStart: '06:00' },
  { employeeId: SHOP, scheduleDate: `${DAY3}T00:00:00Z`, scheduledStart: '06:00' },
  { employeeId: OTHER, scheduleDate: `${DAY2}T00:00:00Z`, scheduledStart: '05:30' },
];

/** Mechanic Log: one employee, each day of the range. */
function mechanicLogMinutes(employeeId: string, profile: EmployeePayProfile, days: string[]) {
  return days.map((day) => {
    const dayEntries = entries.filter((row) => row.employee?.id === employeeId && entryWorkDateKey(row) === day);
    return getDayPayMinutes(dayEntries, NOW, payStartForDay(profile, schedules, employeeId, day), profile).totalMinutes;
  });
}

/** Manager dashboard: every employee on the selected day, keyed `${employeeId}-${day}`. */
function managerDashboardMinutes(employeeId: string, profile: EmployeePayProfile, day: string) {
  const byEmployeeDay = new Map<string, string | undefined>();
  for (const row of schedules) byEmployeeDay.set(`${row.employeeId}-${row.scheduleDate.slice(0, 10)}`, row.scheduledStart);
  const dayEntries = entries.filter((row) => entryWorkDateKey(row) === day && getEntryEmployeeKey(row) === employeeId);
  const storedStart = byEmployeeDay.get(`${employeeId}-${day}`);
  return getDayPayMinutes(dayEntries, NOW, scheduledStartFor(profile, storedStart), profile).totalMinutes;
}

describe('scheduledStartsByDay', () => {
  it("keeps only the requested employee's starts", () => {
    const map = scheduledStartsByDay(schedules, SHOP);
    expect(map.get(DAY1)).toBe('06:00');
    expect(map.has(DAY2)).toBe(false);
    expect(scheduledStartsByDay(schedules, undefined).size).toBe(0);
  });
});

describe('Mechanic Log and manager dashboard totals', () => {
  const days = [DAY1, DAY2, DAY3];

  it('pay from the scheduled start, or clock-in when later', () => {
    const shop = {};
    // DAY1 06:00–14:30 = 8h30 − 30 lunch = 8h. DAY2 07:00–15:00 = 8h − 30 = 7h30.
    // DAY3 06:20–15:00 = 8h40 − 30 = 8h10 → rounds to 8h15.
    expect(mechanicLogMinutes(SHOP, shop, days)).toEqual([480, 450, 495]);
  });

  it.each([
    ['shop mechanic', {}],
    ['parts runner', { isPartsRunner: true }],
    ['road mechanic', { isRoadMech: true }],
    ['admin', { isAdmin: true }],
  ])('match day by day for a %s', (_label, profile: EmployeePayProfile) => {
    const log = mechanicLogMinutes(SHOP, profile, days);
    const dashboard = days.map((day) => managerDashboardMinutes(SHOP, profile, day));
    expect(log).toEqual(dashboard);
  });

  it('pays road mechanics and admins from clock-in regardless of a stored start', () => {
    // DAY1 05:45–14:30 = 8h45 − 30 = 8h15.
    expect(mechanicLogMinutes(SHOP, { isRoadMech: true }, [DAY1])).toEqual([495]);
    expect(mechanicLogMinutes(SHOP, { isAdmin: true }, [DAY1])).toEqual([495]);
  });
});
