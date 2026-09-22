import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { ShopTimeEntryPTOTypeKeyToLabel } from '@/models/shop-time-entry';

export const QUARTER_HOUR_MINUTES = 15;
export const LUNCH_MINUTES = 30;
export const NO_LUNCH_MARKER = '[NO_LUNCH]';

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

export function notesHaveNoLunch(notes?: string): boolean {
  return (notes ?? '').includes(NO_LUNCH_MARKER);
}

export function stripNoLunchMarker(notes?: string): string {
  return (notes ?? '')
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

export type DayPayMinutes = {
  noLunch: boolean;
  lunchDeducted: boolean;
  lunchMinutes: number;
  paidLaborMinutes: number;
  ptoMinutes: number;
  totalMinutes: number;
  minutesByEntryId: Map<string, number>;
};

export function getDayPayMinutes(entries: ShopTimeEntry[], now = new Date()): DayPayMinutes {
  const labor = [...entries]
    .filter((entry) => !isPtoEntry(entry))
    .sort((entryA, entryB) => new Date(entryA.clockIn ?? 0).getTime() - new Date(entryB.clockIn ?? 0).getTime());
  const pto = entries.filter((entry) => isPtoEntry(entry));
  const noLunch = dayHasNoLunch(labor);
  const rawById = new Map(labor.map((entry) => [entry.id, getRawDurationMinutes(entry, now)]));
  const rawSum = [...rawById.values()].reduce((total, minutes) => total + minutes, 0);
  const lunchMinutes = !noLunch && rawSum > 0 ? LUNCH_MINUTES : 0;
  const target = roundToNearestQuarterHour(Math.max(0, rawSum - lunchMinutes));
  const nearest = labor.map((entry) => ({
    id: entry.id,
    minutes: roundToNearestQuarterHour(rawById.get(entry.id) ?? 0),
  }));
  const nearestSum = nearest.reduce((total, row) => total + row.minutes, 0);
  if (nearest.length > 0) {
    const last = nearest[nearest.length - 1];
    last.minutes = Math.max(0, last.minutes + (target - nearestSum));
  }
  const minutesByEntryId = new Map<string, number>(nearest.map((row) => [row.id, row.minutes]));
  let ptoMinutes = 0;
  for (const entry of pto) {
    const minutes = getPtoHours(entry) * 60;
    ptoMinutes += minutes;
    minutesByEntryId.set(entry.id, minutes);
  }
  const paidLaborMinutes = nearest.reduce((total, row) => total + row.minutes, 0);
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

export function getEntryPaidMinutes(dayEntries: ShopTimeEntry[], entry: ShopTimeEntry, now = new Date()): number {
  return getDayPayMinutes(dayEntries, now).minutesByEntryId.get(entry.id) ?? 0;
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
