import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import {
  applyNoLunchMarker,
  dayHasNoLunch,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  getRawDurationMinutes,
  isPtoEntry,
  lunchCsvLabel,
  notesHaveNoLunch,
  roundClockInUpToQuarterHour,
  roundToNearestQuarterHour,
  scheduledStartFor,
  stripNoLunchMarker,
  NO_LUNCH_MARKER,
  NO_SCHEDULED_START,
} from '@/lib/time-rules';

/**
 * Builds an ISO string from a local wall-clock time. The pay rules compare
 * clock-ins against a local scheduled start, so tests must express times in
 * local time to stay correct in any timezone.
 */
function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return { timeEntry: 'Time entry', ...overrides };
}

const DAY = '2026-03-10';

describe('roundToNearestQuarterHour', () => {
  it('rounds to the nearest 15 minute increment', () => {
    expect(roundToNearestQuarterHour(8)).toBe(15);
    expect(roundToNearestQuarterHour(22)).toBe(15);
    expect(roundToNearestQuarterHour(23)).toBe(30);
    expect(roundToNearestQuarterHour(480)).toBe(480);
  });

  it('treats non-positive and non-finite input as zero', () => {
    expect(roundToNearestQuarterHour(0)).toBe(0);
    expect(roundToNearestQuarterHour(-30)).toBe(0);
    expect(roundToNearestQuarterHour(Number.NaN)).toBe(0);
    // 7 minutes rounds down to nothing rather than up to a quarter hour.
    expect(roundToNearestQuarterHour(7)).toBe(0);
  });
});

describe('roundClockInUpToQuarterHour', () => {
  it('always rounds a clock-in forward to the next quarter hour', () => {
    expect(new Date(roundClockInUpToQuarterHour(at(DAY, '07:01'))).getMinutes()).toBe(15);
    expect(new Date(roundClockInUpToQuarterHour(at(DAY, '07:14'))).getMinutes()).toBe(15);
    expect(new Date(roundClockInUpToQuarterHour(at(DAY, '07:16'))).getMinutes()).toBe(30);
  });

  it('leaves an exact quarter hour untouched', () => {
    const exact = at(DAY, '07:30');
    expect(roundClockInUpToQuarterHour(exact)).toBe(new Date(exact).toISOString());
  });

  it('rolls into the next hour', () => {
    const rounded = new Date(roundClockInUpToQuarterHour(at(DAY, '07:50')));
    expect(rounded.getHours()).toBe(8);
    expect(rounded.getMinutes()).toBe(0);
  });
});

describe('PTO detection', () => {
  it('reads hours from the PTO time key', () => {
    expect(getPtoHours(entry({ id: 'a', pTOTimeKey: 'PTOTimeKey04' }))).toBe(4);
    expect(getPtoHours(entry({ id: 'b', pTOTimeKey: 'PTOTimeKey18' }))).toBe(8);
  });

  it('falls back to the hours field for PTO job numbers', () => {
    expect(getPtoHours(entry({ id: 'c', jobNumber: 'PTO', hours: 6 }))).toBe(6);
  });

  it('reports zero hours for ordinary labor', () => {
    expect(getPtoHours(entry({ id: 'd', jobNumber: '1234', hours: 8 }))).toBe(0);
    expect(isPtoEntry(entry({ id: 'd', jobNumber: '1234', hours: 8 }))).toBe(false);
  });

  it('recognizes PTO named in the time entry label', () => {
    expect(isPtoEntry(entry({ id: 'e', timeEntry: 'Smith - PTO' }))).toBe(true);
  });
});

describe('no-lunch marker', () => {
  it('round-trips the marker without disturbing the note text', () => {
    const withMarker = applyNoLunchMarker('Replaced hydraulic line', true);
    expect(withMarker).toContain(NO_LUNCH_MARKER);
    expect(notesHaveNoLunch(withMarker)).toBe(true);
    expect(stripNoLunchMarker(withMarker)).toBe('Replaced hydraulic line');
  });

  it('removes the marker when no-lunch is turned back off', () => {
    const cleared = applyNoLunchMarker(`${NO_LUNCH_MARKER} Replaced hydraulic line`, false);
    expect(cleared).toBe('Replaced hydraulic line');
    expect(notesHaveNoLunch(cleared)).toBe(false);
  });

  it('strips auto-clock-out boilerplate and collapses whitespace', () => {
    expect(stripNoLunchMarker('Fixed   brakes. Auto-clocked out when starting next asset.')).toBe('Fixed brakes.');
  });

  it('handles undefined notes', () => {
    expect(notesHaveNoLunch(undefined)).toBe(false);
    expect(stripNoLunchMarker(undefined)).toBe('');
    expect(applyNoLunchMarker(undefined, true)).toBe(NO_LUNCH_MARKER);
  });

  it('ignores the marker on PTO entries when scanning a day', () => {
    const pto = entry({ id: 'p', pTOTimeKey: 'PTOTimeKey18', notes: NO_LUNCH_MARKER });
    expect(dayHasNoLunch([pto])).toBe(false);
  });
});

describe('getRawDurationMinutes', () => {
  it('measures a closed shift', () => {
    const shift = entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '15:30') });
    expect(getRawDurationMinutes(shift)).toBe(510);
  });

  it('measures an open shift against the current time', () => {
    const shift = entry({ id: 'a', clockIn: at(DAY, '07:00') });
    expect(getRawDurationMinutes(shift, new Date(at(DAY, '09:00')))).toBe(120);
  });

  it('returns PTO hours instead of a clock duration', () => {
    expect(getRawDurationMinutes(entry({ id: 'a', pTOTimeKey: 'PTOTimeKey04' }))).toBe(240);
  });

  it('returns zero without a clock-in', () => {
    expect(getRawDurationMinutes(entry({ id: 'a' }))).toBe(0);
  });
});

describe('getDayPayMinutes', () => {
  it('deducts a 30 minute lunch from a full shift', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '15:30') })];
    const pay = getDayPayMinutes(day);

    expect(pay.lunchDeducted).toBe(true);
    expect(pay.lunchMinutes).toBe(30);
    expect(pay.paidLaborMinutes).toBe(480);
    expect(pay.totalMinutes).toBe(480);
  });

  it('skips the lunch deduction when the day is flagged no-lunch', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '15:00'), notes: NO_LUNCH_MARKER })];
    const pay = getDayPayMinutes(day);

    expect(pay.noLunch).toBe(true);
    expect(pay.lunchDeducted).toBe(false);
    expect(pay.paidLaborMinutes).toBe(480);
  });

  it('does not deduct lunch when no labor was logged', () => {
    const pay = getDayPayMinutes([]);
    expect(pay.lunchMinutes).toBe(0);
    expect(pay.totalMinutes).toBe(0);
  });

  it('clamps an early clock-in up to the scheduled start', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '15:00') })];

    // 06:30 is pulled forward to the 07:00 default start, leaving 8h less lunch.
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(450);
    // With an earlier scheduled start the full pre-07:00 time is paid.
    expect(getDayPayMinutes(day, new Date(), '06:00').paidLaborMinutes).toBe(480);
  });

  it('only clamps the first entry of the day', () => {
    const day = [
      entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') }),
      entry({ id: 'second', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day, new Date(), '08:00');

    // The 07:00 start is pulled forward to 08:00, leaving 3h on the first entry.
    expect(pay.minutesByEntryId.get('first')).toBe(180);
    // 3h + 4h less a 30 minute lunch.
    expect(pay.paidLaborMinutes).toBe(390);
  });

  it('pays nothing for a first entry that ends before the scheduled start', () => {
    const day = [
      entry({ id: 'early', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') }),
      entry({ id: 'scheduled', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day, new Date(), '12:00');

    // Clamping moves the clock-in past its own clock-out, so the entry is unpaid.
    expect(pay.minutesByEntryId.get('early')).toBe(0);
    // The later entry is never clamped, so it keeps 4h less the lunch deduction.
    expect(pay.paidLaborMinutes).toBe(210);
  });

  it('reconciles per-entry rounding so the day total stays exact', () => {
    const day = [
      entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:07') }),
      entry({ id: 'second', clockIn: at(DAY, '11:07'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day);

    // Raw 480 minutes less a 30 minute lunch, rounded to a quarter hour.
    expect(pay.paidLaborMinutes).toBe(450);
    // Each entry rounds to 240, and the remainder is absorbed by the last entry.
    expect(pay.minutesByEntryId.get('first')).toBe(240);
    expect(pay.minutesByEntryId.get('second')).toBe(210);
    expect([...pay.minutesByEntryId.values()].reduce((sum, value) => sum + value, 0)).toBe(450);
  });

  it('sorts entries by clock-in before applying the scheduled start', () => {
    const outOfOrder = [
      entry({ id: 'later', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') }),
      entry({ id: 'earlier', clockIn: at(DAY, '06:00'), clockOut: at(DAY, '11:00') }),
    ];
    // The 06:00 entry is treated as first and clamped to 07:00, giving 8h less lunch.
    expect(getDayPayMinutes(outOfOrder).paidLaborMinutes).toBe(450);
  });

  it('adds PTO on top of labor without taking a lunch deduction from it', () => {
    const day = [
      entry({ id: 'labor', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') }),
      entry({ id: 'pto', pTOTimeKey: 'PTOTimeKey04', pTOTypeKey: 'Vacation' }),
    ];
    const pay = getDayPayMinutes(day);

    expect(pay.paidLaborMinutes).toBe(210);
    expect(pay.ptoMinutes).toBe(240);
    expect(pay.totalMinutes).toBe(450);
    expect(pay.minutesByEntryId.get('pto')).toBe(240);
  });

  it('pays a road mechanic from the actual clock-in instead of a default start', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '05:30'), clockOut: at(DAY, '15:00') })];

    // Without a start on record the 05:30 punch is pulled forward to 07:00.
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(450);
    // NO_SCHEDULED_START suppresses the clamp, paying all 9.5h less lunch.
    expect(getDayPayMinutes(day, new Date(), NO_SCHEDULED_START).paidLaborMinutes).toBe(540);
  });

  it('exposes a single entry share through getEntryPaidMinutes', () => {
    const first = entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') });
    const day = [first, entry({ id: 'second', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') })];
    expect(getEntryPaidMinutes(day, first)).toBe(240);
  });
});

describe('scheduledStartFor', () => {
  it('suppresses the clamp for road mechanics even when a start is stored', () => {
    expect(scheduledStartFor({ isRoadMech: true }, '06:00')).toBe(NO_SCHEDULED_START);
  });

  it('passes the stored start through for shop mechanics', () => {
    expect(scheduledStartFor({ isRoadMech: false }, '06:00')).toBe('06:00');
  });

  it('leaves an unknown employee on the default-start path', () => {
    // undefined, not null: the caller has no start on record rather than an
    // employee who is paid from clock-in.
    expect(scheduledStartFor(undefined)).toBeUndefined();
    expect(scheduledStartFor(null)).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(0)).toBe('0h 0m');
    expect(formatDuration(45)).toBe('0h 45m');
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(480)).toBe('8h 0m');
  });

  it('clamps negative input to zero', () => {
    expect(formatDuration(-15)).toBe('0h 0m');
  });
});

describe('lunchCsvLabel', () => {
  it('describes how lunch was handled for the day', () => {
    expect(lunchCsvLabel([entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '15:30') })])).toBe('30 minutes deducted');
    expect(lunchCsvLabel([entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '15:30'), notes: NO_LUNCH_MARKER })])).toBe(
      'No lunch',
    );
    expect(lunchCsvLabel([])).toBe('');
  });
});
