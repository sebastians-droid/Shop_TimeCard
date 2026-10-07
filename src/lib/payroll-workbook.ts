import type ExcelJS from 'exceljs';
import { addDays, format } from 'date-fns';

export type PayrollDetailRow = {
  workDate: string;
  punchIn: string;
  punchOut: string;
  hours: number;
  lunch: string;
  ptoTime: string;
  ptoType: string;
  division: string;
  asset: string;
  jobNumber: string;
  payType: string;
  status: string;
  /** Semicolon-separated review flags, e.g. active punches or shifts over 12 hours. */
  flags: string;
  notes: string;
  scheduledStart: string;
  clockInDistance?: number | null;
  clockOutDistance?: number | null;
};

export type PayrollEmployeeExport = {
  name: string;
  number: string;
  dayHours: number[];
  noLunchDays: string[];
  weekHours: number;
  reviewFlags?: string;
  rows: PayrollDetailRow[];
};

export type PayrollWeekExport = {
  weekStart: Date;
  weekEnd: Date;
  employees: PayrollEmployeeExport[];
};

/** Excel rejects these characters in sheet names and caps them at 31 characters. */
export function excelSheetName(name: string, used: Set<string>): string {
  const cleaned =
    name
      .replace(/[:\\/?*[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Employee';
  const base = cleaned.slice(0, 31);
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function hoursNumber(value: number): number {
  return Math.round((value / 60) * 100) / 100;
}

const headerFill: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};
const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const flaggedRowFill: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF3CD' },
};

function styleHeader(row: ExcelJS.Row) {
  row.font = headerFont;
  row.fill = headerFill;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
}

export async function buildPayrollWorkbookBlob(data: PayrollWeekExport): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shop Timecard';
  workbook.created = new Date();
  const weekLabel = `${format(data.weekStart, 'M/d/yyyy')} - ${format(data.weekEnd, 'M/d/yyyy')}`;
  const dayDates = Array.from({ length: 7 }, (_value, index) => addDays(data.weekStart, index));
  const dayHeaders = dayDates.map((date) => format(date, 'EEE M/d'));
  const usedNames = new Set<string>(['summary']);

  const summary = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3 }] });
  summary.mergeCells('A1:L1');
  summary.getCell('A1').value = `Shop Timecard weekly summary · ${weekLabel}`;
  summary.getCell('A1').font = { bold: true, size: 14 };
  summary.getCell('A2').value =
    'Hours are paid time after lunch and 15-minute rounding. Yellow rows on employee sheets flag active punches or shifts over 12 hours.';
  summary.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  const summaryHeader = summary.addRow(['Employee', 'Employee number', ...dayHeaders, 'Week total', 'No-lunch days', 'Review flags']);
  styleHeader(summaryHeader);

  data.employees.forEach((employee) => {
    const reviewFlags = employee.reviewFlags ?? '';
    const row = summary.addRow([
      employee.name,
      employee.number,
      ...employee.dayHours.map((minutes) => (minutes > 0 ? hoursNumber(minutes) : '')),
      hoursNumber(employee.weekHours),
      employee.noLunchDays.join(', '),
      reviewFlags,
    ]);
    if (reviewFlags) {
      row.getCell(12).fill = flaggedRowFill;
    }
    row.eachCell((cell, colNumber) => {
      if (colNumber >= 3 && colNumber <= 10) {
        cell.numFmt = '0.00';
        cell.alignment = { horizontal: 'center' };
      }
    });
  });

  const totalsRow = summary.addRow([
    'Shop total',
    '',
    ...dayDates.map((_date, dayIndex) =>
      hoursNumber(data.employees.reduce((total, employee) => total + (employee.dayHours[dayIndex] ?? 0), 0)),
    ),
    hoursNumber(data.employees.reduce((total, employee) => total + employee.weekHours, 0)),
    '',
    '',
  ]);
  totalsRow.font = { bold: true };
  totalsRow.eachCell((cell, colNumber) => {
    if (colNumber >= 3 && colNumber <= 10) {
      cell.numFmt = '0.00';
      cell.alignment = { horizontal: 'center' };
    }
  });

  summary.columns = [
    { width: 28 },
    { width: 16 },
    ...dayHeaders.map(() => ({ width: 12 })),
    { width: 12 },
    { width: 28 },
    { width: 24 },
  ];

  const detailHeaders = [
    'Employee',
    'Employee number',
    'Work date',
    'Scheduled Start',
    'Punch in',
    'Punch out',
    'Hours',
    'RT',
    'OT',
    'Lunch',
    'PTO time',
    'PTO type',
    'Division',
    'Asset',
    'Job number',
    'Pay type',
    'Status',
    'Flags',
    'Clock In Dist (mi)',
    'Clock Out Dist (mi)',
  ];

  data.employees.forEach((employee) => {
    if (employee.rows.length === 0) {
      return;
    }
    const sheetName = excelSheetName(`${employee.number} ${employee.name}`, usedNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    const header = sheet.addRow(detailHeaders);
    styleHeader(header);

    employee.rows.forEach((detail) => {
      const row = sheet.addRow([
        employee.name,
        employee.number,
        detail.workDate,
        detail.scheduledStart,
        detail.punchIn,
        detail.punchOut,
        detail.hours,
        // RT/OT stay empty so payroll can balance a 40-hour week.
        '',
        '',
        detail.lunch,
        detail.ptoTime,
        detail.ptoType,
        detail.division,
        detail.asset,
        detail.jobNumber,
        detail.payType,
        detail.status,
        detail.flags,
        detail.clockInDistance != null ? detail.clockInDistance : '',
        detail.clockOutDistance != null ? detail.clockOutDistance : '',
      ]);
      row.getCell(7).numFmt = '0.00';
      if (detail.flags) {
        row.eachCell((cell) => {
          cell.fill = flaggedRowFill;
        });
      }
    });
    if (employee.rows.length > 0) {
      const total = sheet.addRow([
        '',
        '',
        '',
        '',
        '',
        'Employee week total',
        hoursNumber(employee.weekHours),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      total.font = { bold: true };
      total.getCell(7).numFmt = '0.00';
    }
    sheet.columns = [
      { width: 24 },
      { width: 16 },
      { width: 12 },
      { width: 14 },
      { width: 20 },
      { width: 20 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 22 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 18 },
      { width: 14 },
      { width: 16 },
      { width: 12 },
      { width: 28 },
      { width: 18 },
      { width: 18 },
    ];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
