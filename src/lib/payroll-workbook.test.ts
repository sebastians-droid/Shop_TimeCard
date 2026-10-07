import { describe, expect, it } from 'vitest';

import type { PayrollDetailRow, PayrollEmployeeExport } from '@/lib/payroll-workbook';
import { buildPayrollWorkbookBlob, excelSheetName, hoursNumber } from '@/lib/payroll-workbook';

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
    flags: '',
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

describe('buildPayrollWorkbookBlob', () => {
  it('puts scheduled start before punch in and leaves RT/OT blank', async () => {
    const employee: PayrollEmployeeExport = {
      name: 'Test Mechanic',
      number: '1234',
      dayHours: [480, 0, 0, 0, 0, 0, 0],
      noLunchDays: [],
      weekHours: 480,
      rows: [
        row({
          workDate: '2026-03-09',
          punchIn: '3/9/2026 6:30 AM',
          punchOut: '3/9/2026 3:00 PM',
          hours: 10,
          scheduledStart: '07:00',
          asset: 'PT318',
        }),
      ],
    };
    const blob = await buildPayrollWorkbookBlob({
      weekStart: new Date(2026, 2, 8),
      weekEnd: new Date(2026, 2, 14),
      employees: [employee],
    });
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets.find((candidate) => candidate.name !== 'Summary');
    expect(sheet).toBeDefined();
    const headers = (sheet!.getRow(1).values as Array<string | undefined>).map((value) => value ?? '');
    const scheduledCol = headers.indexOf('Scheduled Start');
    const punchInCol = headers.indexOf('Punch in');
    const rtCol = headers.indexOf('RT');
    const otCol = headers.indexOf('OT');
    expect(scheduledCol).toBeGreaterThan(0);
    expect(scheduledCol).toBeLessThan(punchInCol);
    const data = sheet!.getRow(2).values as Array<string | number | undefined>;
    expect(data[scheduledCol]).toBe('07:00');
    expect(data[punchInCol]).toBe('3/9/2026 6:30 AM');
    expect(data[rtCol] ?? '').toBe('');
    expect(data[otCol] ?? '').toBe('');
    const total = sheet!.getRow(3).values as Array<string | number | undefined>;
    expect(total[rtCol] ?? '').toBe('');
    expect(total[otCol] ?? '').toBe('');
  });

  it('includes review flags and highlights flagged detail rows', async () => {
    const employee: PayrollEmployeeExport = {
      name: 'Test Mechanic',
      number: '1234',
      dayHours: [780, 0, 0, 0, 0, 0, 0],
      noLunchDays: [],
      weekHours: 780,
      reviewFlags: '1 active, 1 over 12h',
      rows: [
        row({
          workDate: '2026-03-09',
          punchIn: '3/9/2026 5:00 AM',
          punchOut: '',
          hours: 13,
          scheduledStart: '07:00',
          asset: 'PT318',
          status: 'Active',
          flags: 'Active — no clock-out; Shift over 12 hours',
        }),
      ],
    };
    const blob = await buildPayrollWorkbookBlob({
      weekStart: new Date(2026, 2, 8),
      weekEnd: new Date(2026, 2, 14),
      employees: [employee],
    });
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const summary = workbook.getWorksheet('Summary');
    expect(summary?.getRow(4).getCell(12).value).toBe('1 active, 1 over 12h');
    const sheet = workbook.worksheets.find((candidate) => candidate.name !== 'Summary');
    const headers = (sheet!.getRow(1).values as Array<string | undefined>).map((value) => value ?? '');
    expect(headers).toContain('Flags');
    const flagsCol = headers.indexOf('Flags');
    const data = sheet!.getRow(2).values as Array<string | number | undefined>;
    expect(data[flagsCol]).toContain('Active');
    expect(sheet!.getRow(2).getCell(flagsCol).fill).toMatchObject({ type: 'pattern' });
  });
});
