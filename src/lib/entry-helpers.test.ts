import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';
import type { ShopTimeEntry } from '@/models/shop-time-entry';
import {
  PTO_TIME_KEY_BY_HOURS,
  combineSelectedDateAndTime,
  formatTimeForInput,
  formatScheduledStartTime,
  formatWeekRangeLabel,
  scheduledStartCaption,
  getAssetDisplayName,
  getEmployeeNotes,
  getEntryAssetName,
  getEntryDivision,
  getEntryEmployeeKey,
  getEntryEmployeeName,
  getEntryEmployeeNumber,
  getEntryJobNumber,
  getEntryWorkDateKey,
  getPtoClockInIso,
  getWeekRange,
  isInOpenPayrollWeek,
  mergeDateAndTime,
} from '@/lib/entry-helpers';
import { mapShopEmployees } from '@/lib/shop-employees';
import { NO_LUNCH_MARKER } from '@/lib/time-rules';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return { timeEntry: 'Time entry', ...overrides };
}

// Wednesday of the payroll week running Sun 2026-03-08 through Sat 2026-03-14.
const NOW = new Date(2026, 2, 11, 12, 0, 0);
const THIS_WEEK = '2026-03-10';
const LAST_WEEK = '2026-03-03';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getAssetDisplayName', () => {
  it('falls back to a placeholder for missing assets', () => {
    expect(getAssetDisplayName(null)).toBe('Unassigned asset');
    expect(getAssetDisplayName(undefined)).toBe('Unassigned asset');
    expect(getAssetDisplayName({ id: 'a', asset: '' })).toBe('Unassigned asset');
  });

  it('uses the asset identifier when present', () => {
    expect(getAssetDisplayName({ id: 'a', asset: 'EX-140' })).toBe('EX-140');
  });
});

describe('asset name resolution', () => {
  const assets: EquipmentAsset[] = [{ id: 'asset-1', asset: 'EX-140', divisionCode: 12 }];

  it('labels PTO entries as PTO', () => {
    expect(getEntryAssetName(entry({ id: 'e', pTOTimeKey: 'PTOTimeKey18' }), assets)).toBe('PTO');
  });

  it('resolves the asset name from the linked asset id', () => {
    expect(getEntryAssetName(entry({ id: 'e', asset: { id: 'asset-1', asset: '' } }), assets)).toBe('EX-140');
  });

  it('prefers the name captured on the entry over the live asset list', () => {
    const linked = entry({ id: 'e', asset: { id: 'asset-1', asset: 'EX-140 (retired name)' } });
    expect(getEntryAssetName(linked, assets)).toBe('EX-140 (retired name)');
  });

  it('parses a name out of the time entry label when the asset is gone', () => {
    expect(getEntryAssetName(entry({ id: 'e', timeEntry: 'Smith - LOADER-7' }), assets)).toBe('LOADER-7');
  });

  it('ignores the generic label when falling back', () => {
    expect(getEntryAssetName(entry({ id: 'e', timeEntry: 'Smith - Time entry', jobNumber: '4821' }), assets)).toBe('Job 4821');
  });

  it('falls back to the job number, then the division, then a placeholder', () => {
    expect(getEntryAssetName(entry({ id: 'e', jobNumber: '4821' }), assets)).toBe('Job 4821');
    expect(getEntryAssetName(entry({ id: 'e', assetDivision: 12 }), assets)).toBe('Division 12');
    expect(getEntryAssetName(entry({ id: 'e' }), assets)).toBe('Unassigned asset');
  });

  it('never returns an empty string, so exports always show something', () => {
    expect(getEntryAssetName(entry({ id: 'e' }), [])).not.toBe('');
  });
});

describe('isInOpenPayrollWeek', () => {
  it('accepts entries inside the current Sunday-to-Saturday week', () => {
    expect(isInOpenPayrollWeek(entry({ id: 'e', clockIn: at(THIS_WEEK, '08:00') }))).toBe(true);
    expect(isInOpenPayrollWeek(entry({ id: 'e', clockIn: at('2026-03-08', '00:30') }))).toBe(true);
    expect(isInOpenPayrollWeek(entry({ id: 'e', clockIn: at('2026-03-14', '23:00') }))).toBe(true);
  });

  it('rejects entries from other weeks', () => {
    expect(isInOpenPayrollWeek(entry({ id: 'e', clockIn: at(LAST_WEEK, '08:00') }))).toBe(false);
    expect(isInOpenPayrollWeek(entry({ id: 'e', clockIn: at('2026-03-16', '08:00') }))).toBe(false);
  });

  it('falls back to the work date and rejects entries with neither', () => {
    expect(isInOpenPayrollWeek(entry({ id: 'e', workDate: at(THIS_WEEK, '08:00') }))).toBe(true);
    expect(isInOpenPayrollWeek(entry({ id: 'e' }))).toBe(false);
  });
});

describe('getEntryDivision', () => {
  const assets: EquipmentAsset[] = [{ id: 'asset-1', asset: 'EX-140', divisionCode: 34 }];

  it('tracks the live asset division for the open payroll week', () => {
    const current = entry({ id: 'e', clockIn: at(THIS_WEEK, '08:00'), asset: { id: 'asset-1', asset: 'EX-140' }, assetDivision: 12 });
    // A reassignment applies to work that has not been paid out yet.
    expect(getEntryDivision(current, assets)).toBe('34');
  });

  it('keeps the division recorded at clock-in for closed weeks', () => {
    const historical = entry({
      id: 'e',
      clockIn: at(LAST_WEEK, '08:00'),
      asset: { id: 'asset-1', asset: 'EX-140' },
      assetDivision: 12,
    });
    // Already-exported payroll must stay stable.
    expect(getEntryDivision(historical, assets)).toBe('12');
  });

  it('uses the asset division when the entry never recorded one', () => {
    const noRecorded = entry({ id: 'e', clockIn: at(LAST_WEEK, '08:00'), asset: { id: 'asset-1', asset: 'EX-140' } });
    expect(getEntryDivision(noRecorded, assets)).toBe('34');
  });

  it('returns an empty string when no division is known', () => {
    expect(getEntryDivision(entry({ id: 'e', clockIn: at(THIS_WEEK, '08:00') }), assets)).toBe('');
  });
});

describe('date and time helpers', () => {
  it('formats a stored timestamp for a time input', () => {
    expect(formatTimeForInput(at(THIS_WEEK, '07:05'))).toBe('07:05');
    expect(formatTimeForInput(undefined)).toBe('');
  });

  it('replaces the time on an existing timestamp without moving the date', () => {
    const merged = new Date(mergeDateAndTime(at(THIS_WEEK, '07:00'), '13:45'));
    expect(merged.getHours()).toBe(13);
    expect(merged.getMinutes()).toBe(45);
    expect(merged.getDate()).toBe(10);
  });

  it('combines a selected day with a time string', () => {
    const combined = new Date(combineSelectedDateAndTime(new Date(2026, 2, 10, 23, 30), '06:15'));
    expect(combined.getDate()).toBe(10);
    expect(combined.getHours()).toBe(6);
    expect(combined.getMinutes()).toBe(15);
  });

  it('defaults missing time parts to zero', () => {
    const combined = new Date(combineSelectedDateAndTime(new Date(2026, 2, 10), ''));
    expect(combined.getHours()).toBe(0);
    expect(combined.getMinutes()).toBe(0);
  });

  it('anchors PTO entries at 8am local time', () => {
    const pto = new Date(getPtoClockInIso(new Date(2026, 2, 10, 17, 42)));
    expect(pto.getHours()).toBe(8);
    expect(pto.getMinutes()).toBe(0);
    expect(pto.getDate()).toBe(10);
  });

  it('derives a work date key from the clock-in', () => {
    expect(getEntryWorkDateKey(entry({ id: 'e', clockIn: at(THIS_WEEK, '07:00') }))).toBe('2026-03-10');
    expect(getEntryWorkDateKey(entry({ id: 'e' }))).toBe('No clock-in date');
  });

  it('builds a Sunday-to-Saturday week range', () => {
    const { start, end } = getWeekRange(new Date(2026, 2, 11));
    expect(start.getDate()).toBe(8);
    expect(end.getDate()).toBe(14);
    expect(formatWeekRangeLabel(new Date(2026, 2, 11))).toBe('3/8/2026 - 3/14/2026');
  });
});

describe('scheduled start labels', () => {
  it('formats a 24-hour start for display', () => {
    expect(formatScheduledStartTime('07:00')).toBe('7:00 AM');
    expect(formatScheduledStartTime('13:30')).toBe('1:30 PM');
  });

  it('notes a road mechanic is paid from clock-in', () => {
    expect(scheduledStartCaption({ isRoadMech: true }, '06:00')).toBe('Starts at clock-in');
  });

  it('uses the stored shop start, then the 7:00 default', () => {
    expect(scheduledStartCaption({ isRoadMech: false }, '06:00')).toBe('Scheduled start 6:00 AM');
    expect(scheduledStartCaption({ isRoadMech: false })).toBe('Scheduled start 7:00 AM');
    expect(scheduledStartCaption(undefined)).toBe('Scheduled start 7:00 AM');
  });
});

describe('employee helpers', () => {
  const employees = mapShopEmployees([
    { id: 'emp-1', autoNumber: 'SE-001', empNum: 1042, employee: { id: 'e1', name1: 'Dana Ruiz' } },
    { id: 'emp-2', autoNumber: 'SE-002', empNum: 1007, employee: { id: 'e2', name1: 'Alex Chen' } },
  ]);

  it('keys entries by employee, falling back to the entry id', () => {
    expect(getEntryEmployeeKey(entry({ id: 'e', employee: { id: 'emp-1', autoNumber: 'SE-001' } }))).toBe('emp-1');
    expect(getEntryEmployeeKey(entry({ id: 'e' }))).toBe('e');
  });

  it('resolves employee names and numbers', () => {
    const linked = entry({ id: 'e', employee: { id: 'emp-1', autoNumber: 'SE-001' } });
    expect(getEntryEmployeeName(linked, employees)).toBe('Ruiz, Dana');
    expect(getEntryEmployeeNumber(linked, employees)).toBe('1042');
  });

  it('falls back to the auto number, then a placeholder', () => {
    const unknown = entry({ id: 'e', employee: { id: 'missing', autoNumber: 'SE-999' } });
    expect(getEntryEmployeeName(unknown, employees)).toBe('SE-999');
    expect(getEntryEmployeeNumber(unknown, employees)).toBe('SE-999');
    expect(getEntryEmployeeName(entry({ id: 'e' }), employees)).toBe('Unknown employee');
    expect(getEntryEmployeeNumber(entry({ id: 'e' }), employees)).toBe('—');
  });

  it('hides the no-lunch marker from employee-facing notes', () => {
    expect(getEmployeeNotes(`${NO_LUNCH_MARKER} Swapped the filter`)).toBe('Swapped the filter');
  });

  it('exposes job numbers with an empty-string default', () => {
    expect(getEntryJobNumber(entry({ id: 'e', jobNumber: '4821' }))).toBe('4821');
    expect(getEntryJobNumber(entry({ id: 'e' }))).toBe('');
  });
});

describe('mapShopEmployees', () => {
  it('sorts by display name', () => {
    const mapped = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: 1042, employee: { id: 'e1', name1: 'Dana Ruiz' } },
      { id: 'b', autoNumber: 'SE-002', empNum: 1007, employee: { id: 'e2', name1: 'Alex Chen' } },
    ]);
    expect(mapped.map((employee) => employee.employeeName)).toEqual(['Chen, Alex', 'Ruiz, Dana']);
  });

  it('treats a missing road-mechanic flag as a shop mechanic', () => {
    // Dataverse leaves swank_isroadmech null on rows predating the column.
    const [withoutFlag, withFlag] = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: 1042, employee: { id: 'e1', name1: 'Alex Chen' } },
      { id: 'b', autoNumber: 'SE-002', empNum: 1043, employee: { id: 'e2', name1: 'Dana Ruiz' }, isRoadMech: true },
    ]);

    expect(withoutFlag.isRoadMech).toBe(false);
    expect(withFlag.isRoadMech).toBe(true);
  });

  it('drops employees without a usable employee number', () => {
    const mapped = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: 1042, employee: { id: 'e1', name1: 'Dana Ruiz' } },
      { id: 'b', autoNumber: 'SE-002', empNum: 0, employee: { id: 'e2', name1: 'Zero Number' } },
      { id: 'c', autoNumber: 'SE-003', employee: { id: 'e3', name1: 'No Number' } },
      { id: 'd', autoNumber: 'SE-004', empNum: Number.NaN, employee: { id: 'e4', name1: 'Not A Number' } },
    ]);
    expect(mapped.map((employee) => employee.id)).toEqual(['a']);
  });

  it('coerces string employee numbers coming off the API', () => {
    const mapped = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: '1042' as unknown as number, employee: { id: 'e1', name1: 'Dana Ruiz' } },
    ]);
    expect(mapped[0].employeeCode).toBe(1042);
  });

  it('falls back to the auto number and then a generated label for names', () => {
    const mapped = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: 1042 },
      { id: 'b', autoNumber: '', empNum: 1043 },
    ] as ShopEmployee[]);
    expect(mapped.map((employee) => employee.employeeName)).toEqual(['Employee 1043', 'SE-001']);
  });
});

describe('PTO_TIME_KEY_BY_HOURS', () => {
  it('maps the two selectable PTO lengths to Dataverse keys', () => {
    expect(PTO_TIME_KEY_BY_HOURS[4]).toBe('PTOTimeKey04');
    expect(PTO_TIME_KEY_BY_HOURS[8]).toBe('PTOTimeKey18');
  });
});
