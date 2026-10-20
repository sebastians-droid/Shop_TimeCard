import { format } from 'date-fns';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { ShopTimeEntryPTOTypeKeyToLabel } from '@/models/shop-time-entry';

export const QUARTER_HOUR_MINUTES = 15;
export const LUNCH_MINUTES = 30;
export const DEFAULT_SCHEDULED_START = '07:00';
export const NO_LUNCH_MARKER = '[NO_LUNCH]';

/** An open punch is closed at this age and left for a manager to correct. */
export const AUTO_CLOCK_OUT_HOURS = 16;
export const AUTO_CLOCK_OUT_MS = AUTO_CLOCK_OUT_HOURS * 60 * 60 * 1000;
export const AUTO_CLOCK_OUT_MARKER = '[AUTO_CLOCK_OUT]';

/**
 * Pass as `scheduledStart` for road mechanics, whose paid day begins whenever
 * they clock in. Distinct from `undefined`, which means "no start on record"
 * and still falls back to DEFAULT_SCHEDULED_START.
 */
export const NO_SCHEDULED_START = null;

export type EmployeePayProfile = {
  isRoadMech?: boolean;
  isAdmin?: boolean;
  isPartsRunner?: boolean;
};

export function payProfileFor(employee: EmployeePayProfile | null | undefined): EmployeePayProfile | undefined {
  if (!employee) return undefined;
  return { isRoadMech: employee.isRoadMech, isAdmin: employee.isAdmin, isPartsRunner: employee.isPartsRunner };
}

export function paysFromClockIn(employee: EmployeePayProfile | null | undefined): boolean {
  return Boolean(employee?.isRoadMech || employee?.isAdmin);
}

/** Road and admin employees are paid from clock-in; shop mechanics and parts runners use a scheduled start. */
export const scheduledStartFor = (employee: EmployeePayProfile | null | undefined, storedStart?: string) =>
  paysFromClockIn(employee) ? NO_SCHEDULED_START : storedStart;

export function roundToNearestQuarterHour(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes / QUARTER_HOUR_MINUTES) * QUARTER_HOUR_MINUTES;
}

export function roundClockInUpToQuarterHour(iso: string): string {
  const date = new Date(iso);
  const remainder = date.getMinutes() % QUARTER_HOUR_MINUTES;
  if (remainder === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
    return date.toISOString();
  }
  date.setMinutes(date.getMinutes() - remainder + QUARTER_HOUR_MINUTES, 0, 0);
  return date.toISOString();
}

/**
 * The work day an entry belongs to. The stored work date wins over the
 * clock-in timestamp, so a shift that runs past midnight stays on the day it
 * started instead of splitting across two days.
 */
export function entryWorkDateKey(entry: Pick<ShopTimeEntry, 'workDate' | 'clockIn'>): string | undefined {
  if (entry.workDate) return entry.workDate.slice(0, 10);
  if (!entry.clockIn) return undefined;
  const clockIn = new Date(entry.clockIn);
  if (Number.isNaN(clockIn.getTime())) return undefined;
  return format(clockIn, 'yyyy-MM-dd');
}

export function getPtoHours(entry: ShopTimeEntry): number {
  if (entry.pTOTimeKey === 'PTOTimeKey04') return 4;
  if (entry.pTOTimeKey === 'PTOTimeKey18') return 8;
  if (entry.jobNumber !== 'PTO' && !entry.timeEntry.toLowerCase().includes(' - pto')) return 0;
  return Math.round(entry.hours ?? 0);
}

export function isPtoEntry(entry: ShopTimeEntry): boolean {
  return getPtoHours(entry) > 0 || entry.jobNumber === 'PTO' || entry.timeEntry.toLowerCase().includes(' - pto');
}

/** Label stored on a day punch before any asset has started. */
export const AWAITING_ASSET_LABEL = 'Waiting';

/**
 * A clock-in with no job yet. Records arrival only and is never shown as a job
 * card. Paid time is computed at the day level, not from this row.
 */
export function isAwaitingAsset(entry: ShopTimeEntry): boolean {
  if (isPtoEntry(entry)) return false;
  if (entry.asset?.id || entry.asset?.asset) return false;
  if (entry.jobNumber) return false;
  if (entry.division || entry.assetDivision) return false;
  const label = entry.timeEntry.trim();
  return label === AWAITING_ASSET_LABEL || label.endsWith(` - ${AWAITING_ASSET_LABEL}`);
}

export function notesHaveNoLunch(notes?: string): boolean {
  return (notes ?? '').includes(NO_LUNCH_MARKER);
}

export function notesHaveAutoClockOut(notes?: string): boolean {
  return (notes ?? '').includes(AUTO_CLOCK_OUT_MARKER);
}

export function stripAutoClockOutMarker(notes?: string): string {
  return (notes ?? '').replaceAll(AUTO_CLOCK_OUT_MARKER, '').replace(/\s+/g, ' ').trim();
}

export function applyAutoClockOutMarker(notes?: string): string {
  const cleaned = stripAutoClockOutMarker(notes);
  return cleaned ? `${AUTO_CLOCK_OUT_MARKER} ${cleaned}` : AUTO_CLOCK_OUT_MARKER;
}

/**
 * Carries the review marker onto rewritten notes. Only a manager correcting
 * the row resolves an auto clock-out; a lunch toggle or note edit must not.
 */
export function keepAutoClockOutMarker(previousNotes: string | undefined, nextNotes: string): string {
  return notesHaveAutoClockOut(previousNotes) ? applyAutoClockOutMarker(nextNotes) : nextNotes;
}

/** True once an open labor punch has been running for 16 hours. */
export function isAutoClockOutDue(
  entry: Pick<ShopTimeEntry, 'clockIn' | 'clockOut' | 'jobNumber' | 'pTOTimeKey' | 'timeEntry'>,
  now = new Date(),
): boolean {
  if (!entry.clockIn || entry.clockOut || isPtoEntry(entry as ShopTimeEntry)) return false;
  const start = new Date(entry.clockIn).getTime();
  return Number.isFinite(start) && now.getTime() >= start + AUTO_CLOCK_OUT_MS;
}

/** Clock-out stamped when the system closes a punch: exactly 16 hours after clock-in. */
export function autoClockOutTimestamp(clockIn: string): string {
  return new Date(new Date(clockIn).getTime() + AUTO_CLOCK_OUT_MS).toISOString();
}

export function stripNoLunchMarker(notes?: string): string {
  return stripAutoClockOutMarker(notes)
    .replaceAll(NO_LUNCH_MARKER, '')
    .replace(/\s*Auto-clocked out when starting next asset\.?/gi, '')
    .replace(/\s*Auto-clocked out\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyNoLunchMarker(notes: string | undefined, noLunch: boolean): string {
  const cleaned = stripNoLunchMarker(notes);
  if (!noLunch) return cleaned;
  return cleaned ? `${NO_LUNCH_MARKER} ${cleaned}` : NO_LUNCH_MARKER;
}

export function dayHasNoLunch(entries: ShopTimeEntry[]): boolean {
  return entries.some((entry) => !isPtoEntry(entry) && notesHaveNoLunch(entry.notes));
}

export function getRawDurationMinutes(entry: ShopTimeEntry, now = new Date()): number {
  if (isPtoEntry(entry)) return getPtoHours(entry) * 60;
  if (!entry.clockIn) return 0;
  const start = new Date(entry.clockIn).getTime();
  const end = (entry.clockOut ? new Date(entry.clockOut) : now).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function laborByClockIn(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  return [...entries]
    .filter((entry) => !isPtoEntry(entry) && entry.clockIn)
    .sort((entryA, entryB) => new Date(entryA.clockIn ?? 0).getTime() - new Date(entryB.clockIn ?? 0).getTime());
}

function dayFirstClockInFromLabor(labor: ShopTimeEntry[]): string | undefined {
  return labor[0]?.clockIn;
}

function dayLastClockOutFromLabor(labor: ShopTimeEntry[]): string | undefined {
  if (labor.length === 0 || labor.some((entry) => !entry.clockOut)) return undefined;
  return labor.reduce((latest, entry) => {
    const out = entry.clockOut ?? '';
    return out > latest ? out : latest;
  }, labor[0]?.clockOut ?? '');
}

export type PunchSession = {
  start: string;
  /** Undefined while the session is still clocked in. */
  end?: string;
};

/**
 * Gaps shorter than this between punches are seconds of drift, not a break.
 * Stored punches do not line up exactly (a clock-in is saved on the minute
 * while the first job starts seconds later), so only a real clock-out splits a day.
 */
export const BREAK_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Continuous on-the-clock spans for a day. Job switches stay inside one
 * session; a clock-out followed by a later clock-in starts a new one, and the
 * time between them is an unpaid break.
 */
export function dayPunchSessions(entries: ShopTimeEntry[]): PunchSession[] {
  const sessions: { start: number; end: number }[] = [];
  for (const entry of laborByClockIn(entries)) {
    const start = new Date(entry.clockIn ?? 0).getTime();
    const end = entry.clockOut ? new Date(entry.clockOut).getTime() : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(start)) continue;
    const last = sessions[sessions.length - 1];
    if (last && start - last.end < BREAK_MIN_GAP_MS) {
      last.end = Math.max(last.end, end);
    } else {
      sessions.push({ start, end });
    }
  }
  return sessions.map(({ start, end }) => ({
    start: new Date(start).toISOString(),
    end: Number.isFinite(end) ? new Date(end).toISOString() : undefined,
  }));
}

/** On-the-clock minutes from `payStartMs` onward, skipping breaks between sessions. */
function sessionMinutesFrom(entries: ShopTimeEntry[], payStartMs: number, now: Date): number {
  let total = 0;
  for (const session of dayPunchSessions(entries)) {
    const start = Math.max(new Date(session.start).getTime(), payStartMs);
    const end = session.end ? new Date(session.end).getTime() : now.getTime();
    if (end > start) total += end - start;
  }
  return Math.max(0, Math.round(total / 60000));
}

/**
 * When paid time begins for the day.
 * - Road and admin: actual clock-in.
 * - Shop: scheduled start unless clock-in is later, then clock-in.
 */
export function effectiveDayPayStart(
  dayFirstClockInIso: string,
  scheduledStart: string | null | undefined,
  employee?: EmployeePayProfile | null,
): string {
  if (paysFromClockIn(employee) || scheduledStart === NO_SCHEDULED_START) {
    return dayFirstClockInIso;
  }
  const effectiveStart = scheduledStart ?? DEFAULT_SCHEDULED_START;
  const clockInDate = new Date(dayFirstClockInIso);
  const scheduled = new Date(dayFirstClockInIso);
  const [hours, minutes] = effectiveStart.split(':').map(Number);
  scheduled.setHours(hours, minutes, 0, 0);
  return clockInDate.getTime() > scheduled.getTime() ? dayFirstClockInIso : scheduled.toISOString();
}

export type WaitBeforeFirstJob = {
  minutes: number;
  from: string;
  to: string;
  hasJob: boolean;
};

/**
 * Paid time before the first job. Shop pay starts at the scheduled start, or at
 * clock-in when that is later. Road and admin pay starts at clock-in.
 * This gap stays in the day total and is not its own timecard row.
 */
export function waitBeforeFirstJob(
  entries: ShopTimeEntry[],
  now = new Date(),
  scheduledStart?: string | null,
  employee?: EmployeePayProfile | null,
): WaitBeforeFirstJob | undefined {
  const labor = laborByClockIn(entries);
  const dayFirst = dayFirstClockInFromLabor(labor);
  if (!dayFirst) return undefined;

  const payStartMs = new Date(effectiveDayPayStart(dayFirst, scheduledStart, employee)).getTime();
  const jobs = labor.filter((entry) => !isAwaitingAsset(entry));
  const firstJobMs = jobs[0]?.clockIn ? new Date(jobs[0].clockIn).getTime() : undefined;
  const stillOpen = labor.some((entry) => !entry.clockOut);
  const dayLast = dayLastClockOutFromLabor(labor);
  const endMs = firstJobMs ?? (dayLast ? new Date(dayLast).getTime() : stillOpen ? now.getTime() : undefined);
  if (endMs === undefined || !Number.isFinite(payStartMs) || endMs <= payStartMs) return undefined;

  const minutes = Math.round((endMs - payStartMs) / 60000);
  if (minutes <= 0) return undefined;
  return { minutes, from: new Date(payStartMs).toISOString(), to: new Date(endMs).toISOString(), hasJob: jobs.length > 0 };
}

export type DayPayMinutes = {
  noLunch: boolean;
  lunchDeducted: boolean;
  lunchMinutes: number;
  paidLaborMinutes: number;
  ptoMinutes: number;
  totalMinutes: number;
  minutesByEntryId: Map<string, number>;
};

function allocateDayPayAcrossJobs(payable: ShopTimeEntry[], paidLaborMinutes: number, now: Date): Map<string, number> {
  const minutesByEntryId = new Map<string, number>();
  if (payable.length === 0 || paidLaborMinutes <= 0) return minutesByEntryId;

  const rawById = new Map(payable.map((entry) => [entry.id, getRawDurationMinutes(entry, now)]));
  const rawSum = [...rawById.values()].reduce((total, minutes) => total + minutes, 0);
  const nearest = payable.map((entry) => ({
    id: entry.id,
    minutes: roundToNearestQuarterHour(rawById.get(entry.id) ?? 0),
  }));

  if (rawSum <= 0) {
    nearest[0].minutes = paidLaborMinutes;
    for (const row of nearest) minutesByEntryId.set(row.id, row.minutes);
    return minutesByEntryId;
  }

  let allocated = 0;
  nearest.forEach((row, index) => {
    if (index === nearest.length - 1) {
      row.minutes = Math.max(0, paidLaborMinutes - allocated);
      return;
    }
    const share = roundToNearestQuarterHour(((rawById.get(row.id) ?? 0) / rawSum) * paidLaborMinutes);
    row.minutes = share;
    allocated += share;
  });

  for (const row of nearest) minutesByEntryId.set(row.id, row.minutes);
  return minutesByEntryId;
}

export function getDayPayMinutes(
  entries: ShopTimeEntry[],
  now = new Date(),
  scheduledStart?: string | null,
  employee?: EmployeePayProfile | null,
): DayPayMinutes {
  const labor = laborByClockIn(entries);
  const pto = entries.filter((entry) => isPtoEntry(entry));
  const noLunch = dayHasNoLunch(labor);
  const payable = labor.filter((entry) => !isAwaitingAsset(entry));
  const dayFirst = dayFirstClockInFromLabor(labor);

  const minutesByEntryId = new Map<string, number>();
  let paidLaborMinutes = 0;
  let lunchMinutes = 0;

  if (dayFirst) {
    const payStartIso = effectiveDayPayStart(dayFirst, scheduledStart, employee);
    const rawDayMinutes = sessionMinutesFrom(labor, new Date(payStartIso).getTime(), now);
    // One lunch per day, separate from any clocked-out breaks.
    lunchMinutes = !noLunch && rawDayMinutes > 0 ? LUNCH_MINUTES : 0;
    paidLaborMinutes = roundToNearestQuarterHour(Math.max(0, rawDayMinutes - lunchMinutes));

    if (payable.length === 0) {
      const dayPunch = labor.find((entry) => isAwaitingAsset(entry));
      if (dayPunch) minutesByEntryId.set(dayPunch.id, paidLaborMinutes);
    } else {
      const jobMinutes = allocateDayPayAcrossJobs(payable, paidLaborMinutes, now);
      for (const [id, minutes] of jobMinutes) minutesByEntryId.set(id, minutes);
    }
  }

  for (const entry of labor) {
    if (isAwaitingAsset(entry) && payable.length > 0) minutesByEntryId.set(entry.id, 0);
  }

  let ptoMinutes = 0;
  for (const entry of pto) {
    const minutes = getPtoHours(entry) * 60;
    ptoMinutes += minutes;
    minutesByEntryId.set(entry.id, minutes);
  }

  return {
    noLunch,
    lunchDeducted: lunchMinutes > 0,
    lunchMinutes,
    paidLaborMinutes,
    ptoMinutes,
    totalMinutes: paidLaborMinutes + ptoMinutes,
    minutesByEntryId,
  };
}

export function getEntryPaidMinutes(
  dayEntries: ShopTimeEntry[],
  entry: ShopTimeEntry,
  now = new Date(),
  scheduledStart?: string | null,
  employee?: EmployeePayProfile | null,
): number {
  return getDayPayMinutes(dayEntries, now, scheduledStart, employee).minutesByEntryId.get(entry.id) ?? 0;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(Math.max(0, minutes) / 60);
  const remainingMinutes = Math.max(0, minutes) % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function lunchCsvLabel(dayEntries: ShopTimeEntry[]): string {
  const pay = getDayPayMinutes(dayEntries);
  if (pay.noLunch) return 'No lunch';
  if (pay.lunchDeducted) return '30 minutes deducted';
  return '';
}

export function ptoTypeLabel(entry: ShopTimeEntry): string {
  return entry.pTOTypeKey ? ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey] : '';
}
