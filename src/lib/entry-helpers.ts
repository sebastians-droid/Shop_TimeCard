import { addDays, format, startOfDay, startOfWeek, endOfWeek } from 'date-fns';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry, ShopTimeEntryPTOTimeKey } from '@/models/shop-time-entry';
import { formatEmployeeDisplayName, type AppShopEmployee } from '@/lib/shop-employees';
import { dayFirstClockIn, dayLastClockOut } from '@/lib/day-session';
import {
  DEFAULT_SCHEDULED_START,
  dayPunchSessions,
  entryWorkDateKey,
  isAwaitingAsset,
  isPtoEntry,
  notesHaveAutoClockOut,
  stripNoLunchMarker,
} from '@/lib/time-rules';

export type PtoHours = 4 | 8;

export const PTO_TIME_KEY_BY_HOURS: Record<PtoHours, ShopTimeEntryPTOTimeKey> = { 4: 'PTOTimeKey04', 8: 'PTOTimeKey18' };

export const getAssetDisplayName = (asset?: EquipmentAsset | Pick<EquipmentAsset, 'id' | 'asset'> | null) => {
  if (!asset) return 'Unassigned asset';
  return asset.asset || 'Unassigned asset';
};

/**
 * Best available label for the work an entry covers. Assets can be unlinked or
 * deactivated after the fact, so this walks a fallback chain rather than
 * returning nothing: linked asset, then the name saved on the entry label, then
 * the job number or division. It always returns a non-empty string.
 */
/** Job rows shown in manager views — excludes the arrival-only waiting punch. */
export function jobEntriesForDisplay(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  return entries.filter((entry) => !isAwaitingAsset(entry));
}

function byClockIn(entryA: ShopTimeEntry, entryB: ShopTimeEntry): number {
  return new Date(entryA.clockIn ?? 0).getTime() - new Date(entryB.clockIn ?? 0).getTime();
}

/**
 * Every row a manager can correct, including the no-job punch each clock-in
 * creates. That punch holds the clock-in time, so hiding it would leave a
 * clocked-in employee with nothing to edit until a job starts.
 */
export function entriesForManagerDisplay(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  return [...entries].sort(byClockIn);
}

/**
 * An arrival punch that only records a clock-in, shown to managers as a single
 * line. One the system closed at 16 hours keeps its full card, because its
 * clock-out needs correcting too.
 */
export function isClockInOnlyRow(entry: ShopTimeEntry): boolean {
  return isAwaitingAsset(entry) && !notesHaveAutoClockOut(entry.notes);
}

export function managerEntryTitle(entry: ShopTimeEntry, assets: EquipmentAsset[]): string {
  if (isAwaitingAsset(entry)) return entry.clockOut ? 'Clocked in — no job' : 'Clocked in — no job yet';
  return getEntryAssetName(entry, assets);
}

/** Payroll export rows: job entries plus any open day punch still waiting for a job. */
export function entriesForPayrollExport(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  const jobs = jobEntriesForDisplay(entries);
  const jobIds = new Set(jobs.map((entry) => entry.id));
  const openAwaiting = entries.filter(
    (entry) => isAwaitingAsset(entry) && !jobIds.has(entry.id) && (!entry.clockOut || notesHaveAutoClockOut(entry.notes)),
  );
  return [...jobs, ...openAwaiting].sort(byClockIn);
}

export const PAYROLL_AWAITING_LABEL = 'Clocked in — no job started';

export function dayClockCaption(entries: ShopTimeEntry[]): string {
  const firstIn = dayFirstClockIn(entries);
  if (!firstIn) return '';
  const sessions = dayPunchSessions(entries);
  if (sessions.length > 1) {
    const spans = sessions.map(
      (session) => `${format(new Date(session.start), 'p')}–${session.end ? format(new Date(session.end), 'p') : 'still clocked in'}`,
    );
    return `Clocked in ${spans.join(', ')}`;
  }
  const lastOut = dayLastClockOut(entries);
  const stillIn = entries.some((entry) => !isPtoEntry(entry) && !entry.clockOut);
  const inLabel = format(new Date(firstIn), 'p');
  if (lastOut) return `Day clock-in ${inLabel} · Day clock-out ${format(new Date(lastOut), 'p')}`;
  if (stillIn) return `Day clock-in ${inLabel} · still clocked in`;
  return `Day clock-in ${inLabel}`;
}

export function getEntryAssetName(entry: ShopTimeEntry, assets: EquipmentAsset[]): string {
  if (isPtoEntry(entry)) return 'PTO';
  if (isAwaitingAsset(entry)) return 'Waiting';
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  if (entry.asset?.asset || matchedAsset) return entry.asset?.asset || getAssetDisplayName(matchedAsset);
  const timeEntryParts = entry.timeEntry.split(' - ');
  const savedAssetName = timeEntryParts.length > 1 ? timeEntryParts.slice(1).join(' - ').trim() : '';
  if (savedAssetName && savedAssetName !== 'Time entry') return savedAssetName;
  const jobNumber = getEntryJobNumber(entry);
  if (jobNumber) return `Job ${jobNumber}`;
  return entry.assetDivision ? `Division ${String(entry.assetDivision)}` : 'Unassigned asset';
}

export const getEntryJobNumber = (entry: ShopTimeEntry) => entry.jobNumber ?? '';

export const getPtoClockInIso = (date: Date) => {
  const ptoDate = startOfDay(date);
  ptoDate.setHours(8, 0, 0, 0);
  return ptoDate.toISOString();
};

export const formatTimeForInput = (dateTime?: string) => {
  if (!dateTime) return '';
  return format(new Date(dateTime), 'HH:mm');
};

export const mergeDateAndTime = (existingDateTime: string, timeValue: string) => {
  const date = new Date(existingDateTime);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

export const combineSelectedDateAndTime = (day: Date, timeValue: string) => {
  const date = startOfDay(day);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

/** Places a typed time on whichever calendar day is closest to `nearIso`, so a small correction never jumps a day. */
export function timeNear(nearIso: string, timeValue: string): string {
  const near = new Date(nearIso).getTime();
  const sameDay = new Date(mergeDateAndTime(nearIso, timeValue));
  const candidates = [addDays(sameDay, -1), sameDay, addDays(sameDay, 1)];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.getTime() - near) < Math.abs(best.getTime() - near) ? candidate : best,
  ).toISOString();
}

/** Places a typed time at its next occurrence from `afterIso`, so a clock-out past midnight lands on the next morning. */
export function timeAfter(afterIso: string, timeValue: string): string {
  const candidate = new Date(mergeDateAndTime(afterIso, timeValue));
  if (candidate.getTime() < new Date(afterIso).getTime()) return addDays(candidate, 1).toISOString();
  return candidate.toISOString();
}

/**
 * Places a typed time on a work day. A time that only fits the after-midnight
 * part of that day's shift lands on the next calendar morning; anything else
 * stays on the work day itself.
 */
export function timeOnWorkDay(day: Date, timeValue: string, dayEntries: ShopTimeEntry[], now = new Date()): string {
  const sameDay = combineSelectedDateAndTime(day, timeValue);
  const nextMorning = addDays(new Date(sameDay), 1).getTime();
  const midnight = startOfDay(addDays(day, 1)).getTime();
  const shiftEnd = Math.max(
    0,
    ...dayEntries
      .filter((entry) => entry.clockIn && !isPtoEntry(entry))
      .map((entry) => new Date(entry.clockOut ?? now).getTime()),
  );
  return shiftEnd > midnight && nextMorning <= shiftEnd ? new Date(nextMorning).toISOString() : sameDay;
}

export const EMPLOYEE_CODE_NOT_FOUND = 'Employee code not found. Enter your 4 digit employee number.';

/** Matches a kiosk-entered employee number against the shop roster. */
export const findEmployeeByCode = (employees: AppShopEmployee[], code: string) => {
  const parsed = Number(code.trim());
  if (!Number.isFinite(parsed)) return undefined;
  return employees.find((employee: AppShopEmployee) => employee.employeeCode === parsed);
};

export const getEntryEmployeeKey = (entry: ShopTimeEntry) => entry.employee?.id ?? entry.id;

export const getEntryEmployeeName = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  if (employeeRecord?.employeeName) return employeeRecord.employeeName;
  if (entry.employee?.autoNumber) return formatEmployeeDisplayName(entry.employee.autoNumber) || entry.employee.autoNumber;
  return 'Unknown employee';
};

export const getEntryEmployeeNumber = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return String(employeeRecord?.employeeCode ?? entry.employee?.autoNumber ?? '—');
};

export const isInOpenPayrollWeek = (entry: ShopTimeEntry) => {
  const iso = entry.clockIn ?? entry.workDate;
  if (!iso) return false;
  const now = new Date();
  const entryDate = new Date(iso);
  return entryDate >= startOfWeek(now, { weekStartsOn: 0 }) && entryDate <= endOfWeek(now, { weekStartsOn: 0 });
};

export const getEntryDivision = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  // Entries in the current payroll week track the asset's live division so a
  // reassignment applies to work that hasn't been paid yet. Earlier weeks keep
  // the division recorded at clock-in so already-exported payroll stays stable.
  if (matchedAsset?.divisionCode !== undefined && isInOpenPayrollWeek(entry)) {
    return String(matchedAsset.divisionCode);
  }
  return String(entry.assetDivision ?? matchedAsset?.divisionCode ?? '');
};

export const getEntryWorkDateKey = (entry: ShopTimeEntry) => entryWorkDateKey(entry) ?? 'No clock-in date';

/**
 * A punch time, with its date added when it falls on a different calendar day
 * than the row's work day. A row filed under one day can hold times from the
 * next, and a bare "5:55 AM" hides which morning that was.
 */
export function formatPunchTime(iso: string, entry: Pick<ShopTimeEntry, 'workDate' | 'clockIn'>): string {
  const time = format(new Date(iso), 'p');
  const workDay = entryWorkDateKey(entry);
  return workDay && format(new Date(iso), 'yyyy-MM-dd') !== workDay ? `${time} (${format(new Date(iso), 'EEE, MMM d')})` : time;
}

export const getEmployeeNotes = (notes?: string) => stripNoLunchMarker(notes);

export const getWeekRange = (date: Date) => {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const end = endOfWeek(date, { weekStartsOn: 0 });
  return { start, end };
};

export const formatWeekRangeLabel = (date: Date) => {
  const { start, end } = getWeekRange(date);
  return `${format(start, 'M/d/yyyy')} - ${format(end, 'M/d/yyyy')}`;
};

export const formatScheduledStartTime = (time: string) => {
  const [hours = '0', minutes = '0'] = time.split(':');
  const date = new Date(1970, 0, 1, Number(hours), Number(minutes), 0, 0);
  if (!Number.isFinite(date.getTime())) return time;
  return format(date, 'p');
};

export const scheduledStartCaption = (
  employee: { isRoadMech?: boolean; isAdmin?: boolean } | null | undefined,
  storedStart?: string,
) => {
  if (employee?.isAdmin) return 'Admin — starts at clock-in';
  if (employee?.isRoadMech) return 'Starts at clock-in';
  return `Scheduled start ${formatScheduledStartTime(storedStart || DEFAULT_SCHEDULED_START)}`;
};
