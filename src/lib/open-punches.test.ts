import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { openLaborEntries, openPunchStartedBeforeToday } from '@/lib/open-punches';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year!, month! - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return {
    timeEntry: 'Gamble - LOADER',
    ...overrides,
  };
}

const NOW = new Date(2026, 9, 8, 8, 30, 0, 0);

describe('openLaborEntries', () => {
  it('keeps an open punch from an earlier day and drops closed and PTO rows', () => {
    const stale = entry({ id: 'stale', clockIn: at('2026-10-05', '06:42') });
    const closed = entry({ id: 'closed', clockIn: at('2026-10-05', '07:00'), clockOut: at('2026-10-05', '15:00') });
    const pto = entry({ id: 'pto', timeEntry: 'Gamble - PTO', jobNumber: 'PTO', clockIn: at('2026-10-06', '08:00') });
    const today = entry({ id: 'today', clockIn: at('2026-10-08', '07:00') });

    expect(openLaborEntries([today, pto, closed, stale]).map((row) => row.id)).toEqual(['stale', 'today']);
  });

  it('returns nothing when every punch is already clocked out', () => {
    const closed = entry({ id: 'closed', clockIn: at('2026-10-08', '07:00'), clockOut: at('2026-10-08', '15:00') });
    expect(openLaborEntries([closed])).toEqual([]);
  });
});

describe('openPunchStartedBeforeToday', () => {
  it('flags a punch left open from a previous calendar day', () => {
    expect(openPunchStartedBeforeToday({ clockIn: at('2026-10-05', '06:42') }, NOW)).toBe(true);
    expect(openPunchStartedBeforeToday({ clockIn: at('2026-10-08', '07:00') }, NOW)).toBe(false);
  });
});
