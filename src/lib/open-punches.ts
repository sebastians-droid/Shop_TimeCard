import { format } from 'date-fns';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { isPtoEntry } from '@/lib/time-rules';

/**
 * Labor rows that were clocked in and never clocked out, oldest first.
 * PTO is created already closed, so it is not an open punch.
 * The calendar day of clock-in does not matter: a punch left open overnight
 * is still open.
 */
export function openLaborEntries(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  return entries
    .filter((entry) => Boolean(entry.clockIn) && !entry.clockOut && !isPtoEntry(entry))
    .sort((entryA, entryB) => new Date(entryA.clockIn ?? 0).getTime() - new Date(entryB.clockIn ?? 0).getTime());
}

/** An overnight shift is still live this long after clock-in; past it, an open punch from yesterday was forgotten. */
export const LEFT_OVER_OPEN_MS = 12 * 60 * 60 * 1000;

/**
 * True for a punch someone forgot to close on an earlier day. A shift that
 * simply runs past midnight is not left over until it has been open 12 hours.
 */
export function openPunchIsLeftOver(entry: Pick<ShopTimeEntry, 'clockIn'>, now = new Date()): boolean {
  const clockIn = new Date(entry.clockIn ?? '').getTime();
  if (Number.isNaN(clockIn)) return false;
  return openPunchStartedBeforeToday(entry, now) && now.getTime() - clockIn >= LEFT_OVER_OPEN_MS;
}

/** True when the punch started on a calendar day before `now`. */
export function openPunchStartedBeforeToday(entry: Pick<ShopTimeEntry, 'clockIn'>, now = new Date()): boolean {
  const clockIn = new Date(entry.clockIn ?? '');
  if (Number.isNaN(clockIn.getTime())) return false;
  return format(clockIn, 'yyyy-MM-dd') !== format(now, 'yyyy-MM-dd');
}
