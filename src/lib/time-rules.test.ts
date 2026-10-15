import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import {
  applyNoLunchMarker,
  dayHasNoLunch,
  formatDuration,
  AWAITING_ASSET_LABEL,
  dayPunchSessions,
  effectiveDayPayStart,
  keepAutoClockOutMarker,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  getRawDurationMinutes,
  isAwaitingAsset,
  isPtoEntry,
  lunchCsvLabel,
  notesHaveNoLunch,
  roundClockInUpToQuarterHour,
  roundToNearestQuarterHour,
  scheduledStartFor,
  stripNoLunchMarker,
  AUTO_CLOCK_OUT_MARKER,
  NO_LUNCH_MARKER,
  autoClockOutTimestamp,
  isAutoClockOutDue,
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

describe('16-hour auto clock-out', () => {
  const clockIn = at(DAY, '07:00');

  it('is due at 16 hours and not a minute before', () => {
    const open = entry({ id: 'open', clockIn });
    expect(isAutoClockOutDue(open, new Date(new Date(clockIn).getTime() + 16 * 60 * 60 * 1000 - 60_000))).toBe(false);
    expect(isAutoClockOutDue(open, new Date(new Date(clockIn).getTime() + 16 * 60 * 60 * 1000))).toBe(true);
  });

  it('stamps clock-out exactly 16 hours after clock-in', () => {
    expect(new Date(autoClockOutTimestamp(clockIn)).getTime() - new Date(clockIn).getTime()).toBe(16 * 60 * 60 * 1000);
  });

  it('hides the review marker from notes an employee reads', () => {
    expect(stripNoLunchMarker(`${AUTO_CLOCK_OUT_MARKER} Waiting on parts`)).toBe('Waiting on parts');
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

  it('allocates day pay across jobs when the scheduled start is later than clock-in', () => {
    const day = [
      entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') }),
      entry({ id: 'second', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day, new Date(), '08:00');

    // Day pay runs 08:00–15:00 (7h less lunch), split across the two jobs.
    expect(pay.paidLaborMinutes).toBe(390);
    expect([...pay.minutesByEntryId.values()].reduce((sum, value) => sum + value, 0)).toBe(390);
  });

  it('starts day pay at the scheduled start when clock-in is earlier', () => {
    const day = [
      entry({ id: 'early', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') }),
      entry({ id: 'scheduled', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day, new Date(), '12:00');

    // Day pay runs 12:00–15:00, not from the 07:00 clock-in.
    expect(pay.paidLaborMinutes).toBe(150);
  });

  it('reconciles per-entry allocation so the day total stays exact', () => {
    const day = [
      entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:07') }),
      entry({ id: 'second', clockIn: at(DAY, '11:07'), clockOut: at(DAY, '15:00') }),
    ];
    const pay = getDayPayMinutes(day);

    expect(pay.paidLaborMinutes).toBe(450);
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

  it('pays an admin employee from clock-in like a road mechanic', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '15:00') })];
    expect(getDayPayMinutes(day, new Date(), NO_SCHEDULED_START, { isAdmin: true }).paidLaborMinutes).toBe(480);
  });

  it('pays a road mechanic from the actual clock-in instead of a default start', () => {
    const day = [entry({ id: 'a', clockIn: at(DAY, '05:30'), clockOut: at(DAY, '15:00') })];

    // Without a start on record the 05:30 punch is pulled forward to 07:00.
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(450);
    // NO_SCHEDULED_START suppresses the clamp, paying all 9.5h less lunch.
    expect(getDayPayMinutes(day, new Date(), NO_SCHEDULED_START).paidLaborMinutes).toBe(540);
  });

  it('pays the full day window and leaves the waiting punch at zero when jobs exist', () => {
    const waiting = entry({
      id: 'wait',
      timeEntry: `Smith - ${AWAITING_ASSET_LABEL}`,
      clockIn: at(DAY, '06:30'),
      clockOut: at(DAY, '07:20'),
    });
    const asset = entry({
      id: 'asset',
      timeEntry: 'Smith - EX-140',
      asset: { id: 'a', asset: 'EX-140' },
      clockIn: at(DAY, '07:20'),
      clockOut: at(DAY, '15:20'),
    });
    const pay = getDayPayMinutes([waiting, asset]);

    expect(isAwaitingAsset(waiting)).toBe(true);
    expect(isAwaitingAsset({ ...waiting, id: 'dashed', timeEntry: 'Smith - John - Waiting' })).toBe(true);
    expect(pay.minutesByEntryId.get('wait')).toBe(0);
    // Day pay runs 07:00–15:20 (8h 20m less lunch).
    expect(pay.minutesByEntryId.get('asset')).toBe(465);
    expect(pay.paidLaborMinutes).toBe(465);
  });

  it('uses the scheduled start for day pay when clock-in is early and a job follows', () => {
    const waiting = entry({
      id: 'wait',
      timeEntry: `Smith - ${AWAITING_ASSET_LABEL}`,
      clockIn: at(DAY, '06:15'),
      clockOut: at(DAY, '06:40'),
    });
    const asset = entry({
      id: 'asset',
      timeEntry: 'Smith - EX-140',
      asset: { id: 'a', asset: 'EX-140' },
      clockIn: at(DAY, '06:40'),
      clockOut: at(DAY, '15:00'),
    });
    const pay = getDayPayMinutes([waiting, asset]);

    expect(pay.minutesByEntryId.get('wait')).toBe(0);
    expect(pay.paidLaborMinutes).toBe(450);
  });

  it('pays a clock-out day with only a day punch and no jobs', () => {
    const waiting = entry({
      id: 'wait',
      timeEntry: `Smith - ${AWAITING_ASSET_LABEL}`,
      clockIn: at(DAY, '06:30'),
      clockOut: at(DAY, '15:00'),
    });
    const pay = getDayPayMinutes([waiting]);

    expect(pay.paidLaborMinutes).toBe(450);
    expect(pay.minutesByEntryId.get('wait')).toBe(450);
  });

  it('exposes a single entry share through getEntryPaidMinutes', () => {
    const first = entry({ id: 'first', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:00') });
    const day = [first, entry({ id: 'second', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:00') })];
    expect(getEntryPaidMinutes(day, first)).toBe(225);
  });
});

describe('multiple clock-ins in one day', () => {
  const waiting = (id: string, clockIn: string, clockOut?: string) =>
    entry({ id, timeEntry: `Smith - ${AWAITING_ASSET_LABEL}`, clockIn, clockOut });
  const job = (id: string, clockIn: string, clockOut?: string) =>
    entry({ id, timeEntry: 'Smith - EX-140', asset: { id: 'a', asset: 'EX-140' }, clockIn, clockOut });

  it('splits a day into sessions at each clock-out and later clock-in', () => {
    const day = [
      job('pm', at(DAY, '12:30')),
      job('am2', at(DAY, '09:00'), at(DAY, '11:30')),
      job('am1', at(DAY, '07:00'), at(DAY, '09:00')),
    ];
    expect(dayPunchSessions(day)).toEqual([
      { start: at(DAY, '07:00'), end: at(DAY, '11:30') },
      { start: at(DAY, '12:30'), end: undefined },
    ]);
  });

  it('does not pay the break between a clock-out and the next clock-in', () => {
    // 07:00–11:30 and 12:30–16:00 is 8h on the clock; the 1h break is unpaid.
    const day = [job('am', at(DAY, '07:00'), at(DAY, '11:30')), job('pm', at(DAY, '12:30'), at(DAY, '16:00'))];
    const pay = getDayPayMinutes(day);

    expect(pay.lunchMinutes).toBe(30);
    expect(pay.paidLaborMinutes).toBe(450);
    expect([...pay.minutesByEntryId.values()].reduce((sum, value) => sum + value, 0)).toBe(450);
  });

  it('deducts lunch only once no matter how many times the employee clocks in', () => {
    const day = [
      job('a', at(DAY, '07:00'), at(DAY, '10:00')),
      job('b', at(DAY, '10:15'), at(DAY, '12:00')),
      job('c', at(DAY, '12:45'), at(DAY, '15:00')),
      job('d', at(DAY, '15:10'), at(DAY, '16:10')),
    ];
    // 3h + 1h45m + 2h15m + 1h = 8h on the clock, less one 30-minute lunch.
    const pay = getDayPayMinutes(day);
    expect(pay.lunchMinutes).toBe(30);
    expect(pay.paidLaborMinutes).toBe(450);
  });

  it('pays every session in full when the day is flagged no-lunch', () => {
    const day = [
      job('am', at(DAY, '07:00'), at(DAY, '11:30')),
      { ...job('pm', at(DAY, '12:30'), at(DAY, '16:00')), notes: NO_LUNCH_MARKER },
    ];
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(480);
  });

  it('pays the real kiosk flow: arrival punch, job, clock out, clock back in, job', () => {
    const day = [
      waiting('w1', at(DAY, '06:45'), at(DAY, '07:10')),
      job('j1', at(DAY, '07:10'), at(DAY, '11:30')),
      waiting('w2', at(DAY, '12:15'), at(DAY, '12:20')),
      job('j2', at(DAY, '12:20'), at(DAY, '15:45')),
    ];
    const pay = getDayPayMinutes(day);

    // Pay starts at the 07:00 scheduled start: 07:00–11:30 (4h30m) + 12:15–15:45 (3h30m) = 8h, less lunch.
    expect(pay.paidLaborMinutes).toBe(450);
    expect(pay.minutesByEntryId.get('w1')).toBe(0);
    expect(pay.minutesByEntryId.get('w2')).toBe(0);
    expect((pay.minutesByEntryId.get('j1') ?? 0) + (pay.minutesByEntryId.get('j2') ?? 0)).toBe(450);
  });

  it('counts a second session that is still open up to now', () => {
    const day = [job('am', at(DAY, '07:00'), at(DAY, '11:00')), waiting('back', at(DAY, '12:00'))];
    // 4h in the morning + 1h since clocking back in at 12:00; the 11:00–12:00 break is unpaid.
    expect(getDayPayMinutes(day, new Date(at(DAY, '13:00'))).paidLaborMinutes).toBe(270);
  });

  it('applies the scheduled start only to the first session', () => {
    const day = [job('early', at(DAY, '06:00'), at(DAY, '06:40')), job('later', at(DAY, '08:00'), at(DAY, '12:00'))];
    // 06:00–06:40 falls before the 07:00 start and is unpaid; the 08:00 session is paid in full.
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(210);
    // A road mechanic is paid from clock-in, so the early session counts too.
    expect(getDayPayMinutes(day, new Date(), NO_SCHEDULED_START, { isRoadMech: true }).paidLaborMinutes).toBe(255);
  });

  it('treats a job switch as one continuous session, not a break', () => {
    const day = [job('a', at(DAY, '07:00'), at(DAY, '11:00')), job('b', at(DAY, '11:00'), at(DAY, '15:30'))];
    expect(dayPunchSessions(day)).toHaveLength(1);
    expect(getDayPayMinutes(day).paidLaborMinutes).toBe(480);
  });

  it('treats seconds of drift between the clock-in and the first job as one session', () => {
    // Stored punches from a real day: clock-in saved on the minute, the first job 34 seconds later.
    const day = [
      waiting('w', '2026-10-15T10:55:00Z', '2026-10-15T10:55:00Z'),
      job('pt472', '2026-10-15T10:55:34Z', '2026-10-15T18:09:19Z'),
      job('a094', '2026-10-15T18:09:19Z'),
    ];
    expect(dayPunchSessions(day)).toEqual([{ start: '2026-10-15T10:55:00.000Z', end: undefined }]);
  });

  it('splits on a real break even when it is short', () => {
    const day = [job('am', at(DAY, '07:00'), at(DAY, '10:00')), job('pm', at(DAY, '10:05'), at(DAY, '12:00'))];
    expect(dayPunchSessions(day)).toHaveLength(2);
  });

  it('ignores PTO when finding sessions', () => {
    const day = [
      job('am', at(DAY, '07:00'), at(DAY, '11:00')),
      entry({ id: 'pto', pTOTimeKey: 'PTOTimeKey04', clockIn: at(DAY, '08:00') }),
    ];
    expect(dayPunchSessions(day)).toHaveLength(1);
  });
});

describe('keepAutoClockOutMarker', () => {
  it('keeps the review marker when other parts of the note are rewritten', () => {
    const before = `${AUTO_CLOCK_OUT_MARKER} Left a light on`;
    const after = keepAutoClockOutMarker(before, applyNoLunchMarker(before, true));
    expect(after).toContain(AUTO_CLOCK_OUT_MARKER);
    expect(after).toContain(NO_LUNCH_MARKER);
    expect(stripNoLunchMarker(after)).toBe('Left a light on');
  });

  it('adds nothing when the row was never auto-closed', () => {
    expect(keepAutoClockOutMarker('Fixed brakes', 'Fixed brakes, bled lines')).toBe('Fixed brakes, bled lines');
  });
});

describe('effectiveDayPayStart', () => {
  it('pays shop employees from scheduled start unless they clock in late', () => {
    expect(effectiveDayPayStart(at(DAY, '06:30'), '07:00')).toBe(at(DAY, '07:00'));
    expect(effectiveDayPayStart(at(DAY, '08:00'), '07:00')).toBe(at(DAY, '08:00'));
  });

  it('pays admin employees from clock-in like road mechanics', () => {
    expect(effectiveDayPayStart(at(DAY, '06:30'), '07:00', { isAdmin: true })).toBe(at(DAY, '06:30'));
    expect(effectiveDayPayStart(at(DAY, '08:00'), '07:00', { isAdmin: true })).toBe(at(DAY, '08:00'));
  });

  it('pays road mechanics from the actual clock-in', () => {
    expect(effectiveDayPayStart(at(DAY, '05:30'), NO_SCHEDULED_START, { isRoadMech: true })).toBe(at(DAY, '05:30'));
  });
});

describe('scheduledStartFor', () => {
  it('suppresses the clamp for road mechanics even when a start is stored', () => {
    expect(scheduledStartFor({ isRoadMech: true }, '06:00')).toBe(NO_SCHEDULED_START);
  });

  it('passes the stored start through for shop mechanics', () => {
    expect(scheduledStartFor({ isRoadMech: false }, '06:00')).toBe('06:00');
  });

  it('suppresses the scheduled start for admin employees', () => {
    expect(scheduledStartFor({ isAdmin: true }, '06:00')).toBe(NO_SCHEDULED_START);
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
