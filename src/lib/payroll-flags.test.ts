import { describe, expect, it } from 'vitest';

import type { ShopTimeEntry } from '@/models/shop-time-entry';
import {
  LONG_SHIFT_MINUTES,
  PAYROLL_FLAG_ACTIVE,
  PAYROLL_FLAG_AUTO_CLOCK_OUT,
  PAYROLL_FLAG_LONG_SHIFT,
  collectPayrollExportIssues,
  countPayrollFlaggedRows,
  formatPayrollExportIssue,
  formatPayrollFlags,
  payrollEntryFlags,
  summarizeEmployeePayrollFlags,
} from '@/lib/payroll-flags';

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return {
    timeEntry: 'Smith - LOADER',
    ...overrides,
  };
}

describe('payrollEntryFlags', () => {
  const now = new Date('2026-03-10T20:00:00');

  it('flags an open punch as active', () => {
    expect(
      payrollEntryFlags(
        entry({
          id: 'e1',
          clockIn: '2026-03-10T07:00:00',
        }),
        new Date('2026-03-10T10:00:00'),
      ),
    ).toEqual([PAYROLL_FLAG_ACTIVE]);
  });

  it('flags a completed shift longer than twelve hours', () => {
    expect(
      payrollEntryFlags(
        entry({
          id: 'e2',
          clockIn: '2026-03-10T05:00:00',
          clockOut: '2026-03-10T18:00:00',
        }),
        now,
      ),
    ).toEqual([PAYROLL_FLAG_LONG_SHIFT]);
  });

  it('can flag both active and long-running open punches', () => {
    const flags = payrollEntryFlags(
      entry({
        id: 'e3',
        clockIn: '2026-03-10T05:00:00',
      }),
      now,
    );
    expect(flags).toContain(PAYROLL_FLAG_ACTIVE);
    expect(flags).toContain(PAYROLL_FLAG_LONG_SHIFT);
  });

  it('flags a system clock-out for manager review instead of as a long shift', () => {
    expect(
      payrollEntryFlags(
        entry({
          id: 'auto',
          clockIn: '2026-03-10T06:00:00',
          clockOut: '2026-03-10T22:00:00',
          notes: '[AUTO_CLOCK_OUT]',
        }),
        now,
      ),
    ).toEqual([PAYROLL_FLAG_AUTO_CLOCK_OUT]);
  });

  it('ignores PTO rows', () => {
    expect(
      payrollEntryFlags(
        entry({
          id: 'e4',
          timeEntry: 'Smith - PTO',
          jobNumber: 'PTO',
          hours: 8,
        }),
        now,
      ),
    ).toEqual([]);
  });

  it('does not flag a normal eight-hour shift', () => {
    expect(
      payrollEntryFlags(
        entry({
          id: 'e5',
          clockIn: '2026-03-10T07:00:00',
          clockOut: '2026-03-10T15:00:00',
        }),
        now,
      ),
    ).toEqual([]);
  });

  it('treats exactly twelve hours as acceptable', () => {
    const clockIn = new Date('2026-03-10T07:00:00');
    const clockOut = new Date(clockIn.getTime() + LONG_SHIFT_MINUTES * 60_000);
    expect(
      payrollEntryFlags(
        entry({
          id: 'e6',
          clockIn: clockIn.toISOString(),
          clockOut: clockOut.toISOString(),
        }),
        now,
      ),
    ).toEqual([]);
  });
});

describe('collectPayrollExportIssues', () => {
  const now = new Date('2026-03-10T18:00:00');

  it('collects open day punches waiting for a first job', () => {
    const issues = collectPayrollExportIssues(
      [
        entry({
          id: 'w',
          timeEntry: 'Smith - Waiting',
          clockIn: '2026-03-10T06:30:00',
        }),
      ],
      [],
      [],
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kinds).toEqual(['active']);
    expect(issues[0]?.label).toBe('Clocked in — no job started');
    expect(formatPayrollExportIssue(issues[0]!)).toContain('Clocked in — no job started');
    expect(formatPayrollExportIssue(issues[0]!)).toContain('still open');
  });

  it('returns no issues when every punch is complete and under twelve hours', () => {
    expect(
      collectPayrollExportIssues(
        [
          entry({
            id: 'j',
            clockIn: '2026-03-10T07:00:00',
            clockOut: '2026-03-10T15:00:00',
          }),
        ],
        [],
        [],
        now,
      ),
    ).toEqual([]);
  });
});

describe('payroll flag summaries', () => {
  it('formats and summarizes flags for export rows', () => {
    const flags = [PAYROLL_FLAG_ACTIVE, PAYROLL_FLAG_LONG_SHIFT];
    expect(formatPayrollFlags(flags)).toBe(`${PAYROLL_FLAG_ACTIVE}; ${PAYROLL_FLAG_LONG_SHIFT}`);
    expect(
      summarizeEmployeePayrollFlags([
        { flags: formatPayrollFlags(flags) },
        { flags: PAYROLL_FLAG_ACTIVE },
        { flags: '' },
      ]),
    ).toBe('2 active, 1 over 12h');
    expect(countPayrollFlaggedRows([{ flags: PAYROLL_FLAG_ACTIVE }, {}, { flags: PAYROLL_FLAG_LONG_SHIFT }])).toBe(2);
  });
});
