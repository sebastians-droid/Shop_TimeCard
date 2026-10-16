import { describe, expect, it } from 'vitest';

import {
  dayFirstClockIn,
  dayLastClockOut,
  findLaborEntryCovering,
  isWithinRoadMechEditWindow,
  jobTimeLocks,
  laborEntries,
  planForgottenJobInsert,
  planJobTimeEdit,
  validateForgottenAssetStart,
  type JobTimeEdit,
} from '@/lib/day-session';
import { dayPunchSessions } from '@/lib/time-rules';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return { timeEntry: 'Time entry', ...overrides };
}

const DAY = '2026-09-30';

describe('laborEntries', () => {
  it('drops PTO rows', () => {
    const labor = entry({ id: 'a', clockIn: at(DAY, '07:00') });
    const pto = entry({ id: 'p', pTOTimeKey: 'PTOTimeKey18', timeEntry: 'Alex - PTO', clockIn: at(DAY, '08:00') });
    expect(laborEntries([labor, pto]).map((row) => row.id)).toEqual(['a']);
  });
});

describe('dayFirstClockIn / dayLastClockOut', () => {
  it('uses the earliest in and latest out when the day is closed', () => {
    const first = entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '11:00') });
    const last = entry({ id: 'b', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:30') });
    expect(dayFirstClockIn([last, first])).toBe(first.clockIn);
    expect(dayLastClockOut([last, first])).toBe(last.clockOut);
  });

  it('leaves last clock-out unset while a row is still open', () => {
    const open = entry({ id: 'a', clockIn: at(DAY, '06:30') });
    expect(dayLastClockOut([open])).toBeUndefined();
    expect(dayFirstClockIn([open])).toBe(open.clockIn);
  });
});

describe('findLaborEntryCovering', () => {
  it('finds the closed row that strictly contains the time', () => {
    const morning = entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '11:00') });
    const afternoon = entry({ id: 'b', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:30') });
    expect(findLaborEntryCovering([morning, afternoon], at(DAY, '10:00'))?.id).toBe('a');
    expect(findLaborEntryCovering([morning, afternoon], at(DAY, '13:00'))?.id).toBe('b');
    expect(findLaborEntryCovering([morning, afternoon], at(DAY, '11:00'))).toBeUndefined();
  });
});

describe('validateForgottenAssetStart', () => {
  const closed = [entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '15:30') })];

  it('rejects times at or before the locked clock-in', () => {
    expect(validateForgottenAssetStart(closed, at(DAY, '06:30'))).toMatch(/after the day's clock-in/i);
    expect(validateForgottenAssetStart(closed, at(DAY, '06:00'))).toMatch(/after the day's clock-in/i);
  });

  it('rejects times at or after the locked clock-out', () => {
    expect(validateForgottenAssetStart(closed, at(DAY, '15:30'))).toMatch(/before the day's clock-out/i);
    expect(validateForgottenAssetStart(closed, at(DAY, '16:00'))).toMatch(/before the day's clock-out/i);
  });

  it('accepts a time strictly inside the locked day', () => {
    expect(validateForgottenAssetStart(closed, at(DAY, '10:00'))).toBeUndefined();
  });

  it('requires a clock-in first', () => {
    expect(validateForgottenAssetStart([], at(DAY, '10:00'))).toMatch(/clock in/i);
  });
});

describe('planForgottenJobInsert', () => {
  it('truncates the previous punch when the new job takes the rest of the day', () => {
    const shift = entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '15:30') });
    const plan = planForgottenJobInsert([shift], at(DAY, '11:00'), at(DAY, '15:30'));
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.patches).toEqual([expect.objectContaining({ id: 'a', clockOut: at(DAY, '11:00') })]);
    expect(plan.creates).toEqual([expect.objectContaining({ kind: 'new', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:30') })]);
  });

  it('keeps the leftover tail of the original job when the new job ends mid-punch', () => {
    const shift = entry({ id: 'a', asset: { id: 'pt', asset: 'PT318' }, clockIn: at(DAY, '06:30'), clockOut: at(DAY, '15:30') });
    const plan = planForgottenJobInsert([shift], at(DAY, '10:00'), at(DAY, '12:00'));
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.patches[0]?.clockOut).toBe(at(DAY, '10:00'));
    expect(plan.creates.map((row) => row.kind)).toEqual(['new', 'remainder']);
    expect(plan.creates[1]).toEqual(expect.objectContaining({ clockIn: at(DAY, '12:00'), clockOut: at(DAY, '15:30'), copyFrom: shift }));
  });

  it('moves the next punch later when the new job runs into it', () => {
    const morning = entry({ id: 'a', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '11:00') });
    const afternoon = entry({ id: 'b', clockIn: at(DAY, '11:00'), clockOut: at(DAY, '15:30') });
    const plan = planForgottenJobInsert([morning, afternoon], at(DAY, '10:00'), at(DAY, '13:00'));
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a', clockOut: at(DAY, '10:00') }),
        expect.objectContaining({ id: 'b', clockIn: at(DAY, '13:00') }),
      ]),
    );
    expect(plan.creates).toEqual([expect.objectContaining({ kind: 'new', clockIn: at(DAY, '10:00'), clockOut: at(DAY, '13:00') })]);
  });

  describe('on a day with a clocked-out break', () => {
    const morning = entry({ id: 'a', clockIn: at(DAY, '07:00'), clockOut: at(DAY, '11:30') });
    const afternoon = entry({ id: 'b', clockIn: at(DAY, '12:30'), clockOut: at(DAY, '16:00') });

    it('rejects a job that would stretch across the break', () => {
      const plan = planForgottenJobInsert([morning, afternoon], at(DAY, '11:00'), at(DAY, '13:00'));
      expect(plan).toEqual({ error: expect.stringMatching(/crosses a break/i) });
    });

    it('rejects a job placed entirely inside the break', () => {
      const plan = planForgottenJobInsert([morning, afternoon], at(DAY, '11:45'), at(DAY, '12:15'));
      expect('error' in plan).toBe(true);
    });

    it('inserts a job inside the second session without touching the first', () => {
      const plan = planForgottenJobInsert([morning, afternoon], at(DAY, '14:00'), at(DAY, '16:00'));
      expect('error' in plan).toBe(false);
      if ('error' in plan) return;
      expect(plan.patches).toEqual([expect.objectContaining({ id: 'b', clockOut: at(DAY, '14:00') })]);
    });
  });
});

/** Replays the planned writes one by one and records the day's punched spans after each. */
function replay(day: ShopTimeEntry[], plan: JobTimeEdit) {
  let rows = day;
  const spans = [JSON.stringify(dayPunchSessions(rows))];
  for (const write of plan.writes) {
    rows =
      write.kind === 'delete'
        ? rows.filter((row) => row.id !== write.id)
        : rows.map((row) =>
            row.id === write.id ? { ...row, clockIn: write.clockIn ?? row.clockIn, clockOut: write.clockOut ?? row.clockOut } : row,
          );
    spans.push(JSON.stringify(dayPunchSessions(rows)));
  }
  return { rows, spans };
}

function span(rows: ShopTimeEntry[], id: string) {
  const row = rows.find((item) => item.id === id);
  return [row?.clockIn, row?.clockOut];
}

describe('planJobTimeEdit', () => {
  const arrival = entry({ id: 'w', timeEntry: 'Alex - Waiting', clockIn: at(DAY, '06:30'), clockOut: at(DAY, '07:00') });
  const loader = entry({
    id: 'a',
    timeEntry: 'Alex - LOADER-7',
    asset: { id: 'l7', asset: 'LOADER-7' },
    clockIn: at(DAY, '07:00'),
    clockOut: at(DAY, '10:00'),
  });
  const truck = entry({
    id: 'b',
    timeEntry: 'Alex - TRUCK-2',
    asset: { id: 't2', asset: 'TRUCK-2' },
    clockIn: at(DAY, '10:00'),
    clockOut: at(DAY, '12:00'),
  });
  const dozer = entry({
    id: 'c',
    timeEntry: 'Alex - DOZER-1',
    asset: { id: 'd1', asset: 'DOZER-1' },
    clockIn: at(DAY, '12:00'),
    clockOut: at(DAY, '15:30'),
  });
  const day = [arrival, loader, truck, dozer];

  it('moves the boundary with the previous job when a start moves later', () => {
    const plan = planJobTimeEdit(day, 'b', at(DAY, '10:30'), at(DAY, '12:00'));
    if ('error' in plan) throw new Error(plan.error);
    const { rows, spans } = replay(day, plan);
    expect(span(rows, 'a')).toEqual([at(DAY, '07:00'), at(DAY, '10:30')]);
    expect(span(rows, 'b')).toEqual([at(DAY, '10:30'), at(DAY, '12:00')]);
    expect(new Set(spans).size).toBe(1);
  });

  it('shrinks the next job when an end moves later, and grows it when an end moves earlier', () => {
    const later = planJobTimeEdit(day, 'b', at(DAY, '10:00'), at(DAY, '13:00'));
    if ('error' in later) throw new Error(later.error);
    expect(span(replay(day, later).rows, 'c')).toEqual([at(DAY, '13:00'), at(DAY, '15:30')]);

    const earlier = planJobTimeEdit(day, 'b', at(DAY, '10:00'), at(DAY, '11:00'));
    if ('error' in earlier) throw new Error(earlier.error);
    const { rows, spans } = replay(day, earlier);
    expect(span(rows, 'c')).toEqual([at(DAY, '11:00'), at(DAY, '15:30')]);
    expect(new Set(spans).size).toBe(1);
  });

  it('keeps clock-in and clock-out unchanged after every write when both edges move', () => {
    const plan = planJobTimeEdit(day, 'b', at(DAY, '09:00'), at(DAY, '11:00'));
    if ('error' in plan) throw new Error(plan.error);
    const { rows, spans } = replay(day, plan);
    expect(span(rows, 'a')).toEqual([at(DAY, '07:00'), at(DAY, '09:00')]);
    expect(span(rows, 'c')).toEqual([at(DAY, '11:00'), at(DAY, '15:30')]);
    expect(new Set(spans).size).toBe(1);
  });

  it('refuses to swallow a whole job', () => {
    expect(planJobTimeEdit(day, 'c', at(DAY, '09:00'), at(DAY, '15:30'))).toEqual({ error: expect.stringMatching(/cover the whole/i) });
  });

  it('removes unassigned time the job now covers', () => {
    const plan = planJobTimeEdit(day, 'a', at(DAY, '06:30'), at(DAY, '10:00'));
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.removedIds).toEqual(['w']);
    const { rows, spans } = replay(day, plan);
    expect(rows.map((row) => row.id)).not.toContain('w');
    expect(span(rows, 'a')).toEqual([at(DAY, '06:30'), at(DAY, '10:00')]);
    expect(new Set(spans).size).toBe(1);
  });

  it('locks the start at clock-in and the end at clock-out', () => {
    expect(jobTimeLocks(day, arrival)).toEqual(expect.objectContaining({ startLocked: true, endLocked: false }));
    expect(jobTimeLocks(day, dozer)).toEqual(expect.objectContaining({ startLocked: false, endLocked: true }));
    expect(planJobTimeEdit(day, 'w', at(DAY, '06:00'), at(DAY, '07:00'))).toEqual({ error: expect.stringMatching(/clock-in/i) });
    expect(planJobTimeEdit(day, 'c', at(DAY, '12:00'), at(DAY, '16:00'))).toEqual({ error: expect.stringMatching(/clock-out/i) });
  });

  it('keeps a job inside its own session across a break', () => {
    const afternoon = entry({ id: 'p', clockIn: at(DAY, '16:30'), clockOut: at(DAY, '18:00') });
    const split = [...day, afternoon];
    expect(planJobTimeEdit(split, 'c', at(DAY, '12:00'), at(DAY, '17:00'))).toEqual({ error: expect.stringMatching(/clock-out/i) });
    expect(planJobTimeEdit(split, 'b', at(DAY, '10:00'), at(DAY, '17:00'))).toEqual({ error: expect.stringMatching(/inside the time/i) });
  });
});

describe('isWithinRoadMechEditWindow', () => {
  it('allows today and the seven days before it', () => {
    const now = new Date(2026, 9, 16, 9, 0);
    expect(isWithinRoadMechEditWindow('2026-10-16', now)).toBe(true);
    expect(isWithinRoadMechEditWindow('2026-10-09', now)).toBe(true);
    expect(isWithinRoadMechEditWindow('2026-10-08', now)).toBe(false);
  });
});
