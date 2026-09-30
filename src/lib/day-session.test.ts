import { describe, expect, it } from 'vitest';

import {
  dayFirstClockIn,
  dayLastClockOut,
  findLaborEntryCovering,
  laborEntries,
  planForgottenJobInsert,
  validateForgottenAssetStart,
} from '@/lib/day-session';
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
});
