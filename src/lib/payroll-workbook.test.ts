import { describe, expect, it } from 'vitest';

import type { PayrollDetailRow } from '@/lib/payroll-workbook';
import { excelSheetName, hoursNumber, splitRegularAndOvertime } from '@/lib/payroll-workbook';

function row(overrides: Partial<PayrollDetailRow> & { workDate: string; hours: number }): PayrollDetailRow {
  return {
    punchIn: '',
    punchOut: '',
    lunch: '',
    ptoTime: '',
    ptoType: '',
    division: '',
    asset: '',
    jobNumber: '',
    payType: '',
    status: '',
    notes: '',
    scheduledStart: '',
    ...overrides,
  };
}

describe('hoursNumber', () => {
  it('converts minutes to hours rounded to two decimals', () => {
    expect(hoursNumber(0)).toBe(0);
    expect(hoursNumber(480)).toBe(8);
    expect(hoursNumber(450)).toBe(7.5);
    expect(hoursNumber(455)).toBe(7.58);
  });
});

describe('excelSheetName', () => {
  it('keeps a short clean name as-is', () => {
    expect(excelSheetName('1042 Dana Ruiz', new Set())).toBe('1042 Dana Ruiz');
  });

  it('replaces characters Excel rejects and collapses whitespace', () => {
    expect(excelSheetName('1042 Dana/Ruiz*[shop]', new Set())).toBe('1042 Dana Ruiz shop');
  });

  it('truncates to Excel\u2019s 31 character limit', () => {
    const name = excelSheetName('1042 Anastasia Fitzgerald-Montgomery', new Set());
    expect(name).toHaveLength(31);
    expect(name).toBe('1042 Anastasia Fitzgerald-Montg');
  });

  it('disambiguates duplicates and stays within the limit', () => {
    const used = new Set<string>();
    const first = excelSheetName('1042 Anastasia Fitzgerald-Montgomery', used);
    const second = excelSheetName('1042 Anastasia Fitzgerald-Montgomery', used);
    const third = excelSheetName('1042 Anastasia Fitzgerald-Montgomery', used);

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(second).toBe('1042 Anastasia Fitzgerald-M (2)');
    expect(second.length).toBeLessThanOrEqual(31);
    expect(third.length).toBeLessThanOrEqual(31);
  });

  it('respects names already reserved by the caller', () => {
    expect(excelSheetName('Summary', new Set(['summary']))).toBe('Summary (2)');
  });

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(excelSheetName('///', new Set())).toBe('Employee');
    expect(excelSheetName('   ', new Set())).toBe('Employee');
  });
});

describe('splitRegularAndOvertime', () => {
  it('keeps a normal day entirely in regular time', () => {
    const shift = row({ workDate: '2026-03-10', hours: 8 });
    expect(splitRegularAndOvertime([shift]).get(shift)).toEqual({ rt: 8, ot: 0 });
  });

  it('pushes hours past eight into overtime', () => {
    const shift = row({ workDate: '2026-03-10', hours: 10 });
    expect(splitRegularAndOvertime([shift]).get(shift)).toEqual({ rt: 8, ot: 2 });
  });

  it('splits overtime across entries once the day crosses eight hours', () => {
    const first = row({ workDate: '2026-03-10', hours: 6 });
    const second = row({ workDate: '2026-03-10', hours: 4 });
    const split = splitRegularAndOvertime([first, second]);

    expect(split.get(first)).toEqual({ rt: 6, ot: 0 });
    expect(split.get(second)).toEqual({ rt: 2, ot: 2 });
  });

  it('puts a whole entry in overtime once the threshold is already met', () => {
    const first = row({ workDate: '2026-03-10', hours: 8 });
    const second = row({ workDate: '2026-03-10', hours: 3 });
    const split = splitRegularAndOvertime([first, second]);

    expect(split.get(second)).toEqual({ rt: 0, ot: 3 });
  });

  it('resets the threshold for each work date', () => {
    const monday = row({ workDate: '2026-03-09', hours: 8 });
    const tuesday = row({ workDate: '2026-03-10', hours: 8 });
    const split = splitRegularAndOvertime([monday, tuesday]);

    expect(split.get(monday)).toEqual({ rt: 8, ot: 0 });
    expect(split.get(tuesday)).toEqual({ rt: 8, ot: 0 });
  });

  it('groups rows by day even when they arrive interleaved', () => {
    const mondayMorning = row({ workDate: '2026-03-09', hours: 6 });
    const tuesdayMorning = row({ workDate: '2026-03-10', hours: 6 });
    const mondayAfternoon = row({ workDate: '2026-03-09', hours: 4 });
    const split = splitRegularAndOvertime([mondayMorning, tuesdayMorning, mondayAfternoon]);

    expect(split.get(mondayAfternoon)).toEqual({ rt: 2, ot: 2 });
    expect(split.get(tuesdayMorning)).toEqual({ rt: 6, ot: 0 });
  });

  it('pays PTO at straight time without consuming the overtime threshold', () => {
    const pto = row({ workDate: '2026-03-10', hours: 8, ptoTime: '8' });
    const worked = row({ workDate: '2026-03-10', hours: 8 });
    const split = splitRegularAndOvertime([pto, worked]);

    expect(split.get(pto)).toEqual({ rt: 8, ot: 0 });
    // The PTO day does not force the worked shift into overtime.
    expect(split.get(worked)).toEqual({ rt: 8, ot: 0 });
  });

  it('zeroes rows with no positive hours', () => {
    const empty = row({ workDate: '2026-03-10', hours: 0 });
    const negative = row({ workDate: '2026-03-10', hours: -2 });
    const split = splitRegularAndOvertime([empty, negative]);

    expect(split.get(empty)).toEqual({ rt: 0, ot: 0 });
    expect(split.get(negative)).toEqual({ rt: 0, ot: 0 });
  });

  it('returns an empty map for no rows', () => {
    expect(splitRegularAndOvertime([]).size).toBe(0);
  });
});
