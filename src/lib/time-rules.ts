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
};

export function payProfileFor(employee: EmployeePayProfile | null | undefined): EmployeePayProfile | undefined {
  if (!employee) return undefined;
  return { isRoadMech: employee.isRoadMech, isAdmin: employee.isAdmin };
}

export function paysFromClockIn(employee: EmployeePayProfile | null | undefined): boolean {
  return Boolean(employee?.isRoadMech || employee?.isAdmin);
}

/** Road and admin employees are paid from clock-in; shop uses a scheduled start. */
export const scheduledStartFor = (
  employee: EmployeePayProfile | null | undefined,
  storedStart?: string,
) => (paysFromClockIn(employee) ? NO_SCHEDULED_START : storedStart);

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

export type DayPayMinutes = {
  noLunch: boolean;
  lunchDeducted: boolean;
  lunchMinutes: number;
  paidLaborMinutes: number;
  ptoMinutes: number;
  totalMinutes: number;
  minutesByEntryId: Map<string, number>;
};

function allocateDayPayAcrossJobs(
  payable: ShopTimeEntry[],
  paidLaborMinutes: number,
  now: Date,
): Map<string, number> {
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
  const dayLast = dayLastClockOutFromLabor(labor);
  const stillOpen = labor.some((entry) => !entry.clockOut);
  const payEndMs = dayLast ? new Date(dayLast).getTime() : stillOpen && dayFirst ? now.getTime() : null;

  const minutesByEntryId = new Map<string, number>();
  let paidLaborMinutes = 0;
  let lunchMinutes = 0;

  if (dayFirst && payEndMs !== null) {
    const payStartIso = effectiveDayPayStart(dayFirst, scheduledStart, employee);
    const rawDayMinutes = Math.max(0, Math.round((payEndMs - new Date(payStartIso).getTime()) / 60000));
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
