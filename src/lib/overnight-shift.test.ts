import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { getEntryWorkDateKey, timeAfter, timeNear, timeOnWorkDay } from '@/lib/entry-helpers';
import { workDateForClockIn } from '@/lib/day-session';
import { openPunchIsLeftOver } from '@/lib/open-punches';
import { entryDayKey } from '@/lib/punch-map';
import { entryWorkDateKey, getDayPayMinutes, NO_SCHEDULED_START } from '@/lib/time-rules';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year!, month! - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return { timeEntry: 'Cessna - LOADER', ...overrides };
}

const WORK_DAY = '2026-10-13';
const NEXT_DAY = '2026-10-14';
const workDate = `${WORK_DAY}T00:00:00Z`;

const evening = entry({ id: 'evening', clockIn: at(WORK_DAY, '18:00'), clockOut: at(WORK_DAY, '23:00'), workDate });
const pastMidnight = entry({ id: 'late', clockIn: at(WORK_DAY, '23:00'), clockOut: at(NEXT_DAY, '02:00'), workDate });
const afterMidnightJob = entry({ id: 'switch', clockIn: at(NEXT_DAY, '00:30'), clockOut: at(NEXT_DAY, '01:00'), workDate });

describe('entryWorkDateKey', () => {
  it('uses the stored work date, so a job that starts after midnight stays on the shift day', () => {
    expect(entryWorkDateKey(afterMidnightJob)).toBe(WORK_DAY);
    expect(getEntryWorkDateKey(afterMidnightJob)).toBe(WORK_DAY);
    expect(entryDayKey(afterMidnightJob)).toBe(WORK_DAY);
  });

  it('falls back to the local clock-in date, not the UTC one, when no work date is stored', () => {
    // 9 PM local is already the next day in UTC for any timezone west of Greenwich.
    expect(entryWorkDateKey({ clockIn: at(WORK_DAY, '21:00') })).toBe(WORK_DAY);
    expect(entryWorkDateKey({})).toBeUndefined();
    expect(getEntryWorkDateKey(entry({ id: 'blank' }))).toBe('No clock-in date');
  });
});

describe('workDateForClockIn', () => {
  it('keeps a return from a break after midnight on the day the shift started', () => {
    expect(workDateForClockIn([evening], at(NEXT_DAY, '00:30'))).toBe(WORK_DAY);
  });

  it('starts a new day once the person has been off long enough to have gone home', () => {
    expect(workDateForClockIn([pastMidnight], at(NEXT_DAY, '07:00'))).toBe(NEXT_DAY);
  });

  it('uses the calendar day for the first clock-in of a day', () => {
    expect(workDateForClockIn([], at(WORK_DAY, '06:30'))).toBe(WORK_DAY);
  });
});

describe('openPunchIsLeftOver', () => {
  const lateClockIn = { clockIn: at(WORK_DAY, '18:00') };

  it('treats a shift running past midnight as still live', () => {
    expect(openPunchIsLeftOver(lateClockIn, new Date(at(NEXT_DAY, '01:30')))).toBe(false);
  });

  it('flags a punch from an earlier day once it has been open 12 hours', () => {
    expect(openPunchIsLeftOver(lateClockIn, new Date(at(NEXT_DAY, '06:00')))).toBe(true);
  });

  it('never flags a punch from today', () => {
    expect(openPunchIsLeftOver({ clockIn: at(NEXT_DAY, '00:10') }, new Date(at(NEXT_DAY, '23:00')))).toBe(false);
  });
});

describe('typed times around midnight', () => {
  it('timeAfter puts a clock-out earlier than the clock-in on the next morning', () => {
    expect(timeAfter(at(WORK_DAY, '21:00'), '01:30')).toBe(at(NEXT_DAY, '01:30'));
    expect(timeAfter(at(WORK_DAY, '07:00'), '15:30')).toBe(at(WORK_DAY, '15:30'));
  });

  it('timeNear corrects a time by the smallest amount, even across midnight', () => {
    expect(timeNear(at(NEXT_DAY, '00:20'), '23:50')).toBe(at(WORK_DAY, '23:50'));
    expect(timeNear(at(WORK_DAY, '23:50'), '00:10')).toBe(at(NEXT_DAY, '00:10'));
    expect(timeNear(at(WORK_DAY, '07:00'), '06:30')).toBe(at(WORK_DAY, '06:30'));
  });

  it('timeOnWorkDay uses the next morning only for times inside the after-midnight part of the shift', () => {
    const day = new Date(2026, 9, 13);
    const shift = [evening, pastMidnight];
    expect(timeOnWorkDay(day, '00:30', shift)).toBe(at(NEXT_DAY, '00:30'));
    expect(timeOnWorkDay(day, '19:00', shift)).toBe(at(WORK_DAY, '19:00'));
    expect(timeOnWorkDay(day, '06:00', shift)).toBe(at(WORK_DAY, '06:00'));
    expect(timeOnWorkDay(day, '00:30', [evening])).toBe(at(WORK_DAY, '00:30'));
  });
});

describe('overnight pay', () => {
  it('pays a 6 PM to 2 AM shift as one day with one lunch', () => {
    const pay = getDayPayMinutes([evening, pastMidnight], new Date(at(NEXT_DAY, '09:00')), NO_SCHEDULED_START, {
      isRoadMech: true,
    });
    expect(pay.paidLaborMinutes).toBe(450);
  });
});
