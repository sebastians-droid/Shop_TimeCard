import { format } from 'date-fns';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { AppShopEmployee } from '@/lib/shop-employees';
import {
  entriesForPayrollExport,
  getEntryAssetName,
  getEntryEmployeeName,
  getEntryEmployeeNumber,
  getEntryWorkDateKey,
  PAYROLL_AWAITING_LABEL,
} from '@/lib/entry-helpers';
import { formatDuration, getRawDurationMinutes, isAwaitingAsset, isPtoEntry } from '@/lib/time-rules';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

/** Raw punch span above this is flagged on payroll export for manager review. */
export const LONG_SHIFT_HOURS = 12;
export const LONG_SHIFT_MINUTES = LONG_SHIFT_HOURS * 60;

export const PAYROLL_FLAG_ACTIVE = 'Active — no clock-out';
export const PAYROLL_FLAG_LONG_SHIFT = `Shift over ${LONG_SHIFT_HOURS} hours`;

export type PayrollExportIssueKind = 'active' | 'long-shift';

export type PayrollExportIssue = {
  kinds: PayrollExportIssueKind[];
  employeeName: string;
  employeeNumber: string;
  workDate: string;
  label: string;
  punchIn?: string;
  punchOut?: string;
  durationMinutes: number;
};

export function payrollEntryFlags(entry: ShopTimeEntry, now = new Date()): string[] {
  if (isPtoEntry(entry)) return [];
  const flags: string[] = [];
  if (!entry.clockOut) flags.push(PAYROLL_FLAG_ACTIVE);
  if (getRawDurationMinutes(entry, now) > LONG_SHIFT_MINUTES) flags.push(PAYROLL_FLAG_LONG_SHIFT);
  return flags;
}

export function collectPayrollExportIssues(
  entries: ShopTimeEntry[],
  employees: AppShopEmployee[],
  assets: EquipmentAsset[],
  now = new Date(),
): PayrollExportIssue[] {
  const issues: PayrollExportIssue[] = [];

  for (const entry of entriesForPayrollExport(entries)) {
    const flagLabels = payrollEntryFlags(entry, now);
    if (flagLabels.length === 0) continue;

    const awaiting = isAwaitingAsset(entry);
    issues.push({
      kinds: flagLabels.map((flag) => (flag === PAYROLL_FLAG_ACTIVE ? 'active' : 'long-shift')),
      employeeName: getEntryEmployeeName(entry, employees),
      employeeNumber: getEntryEmployeeNumber(entry, employees),
      workDate: getEntryWorkDateKey(entry),
      label: awaiting ? PAYROLL_AWAITING_LABEL : getEntryAssetName(entry, assets),
      punchIn: entry.clockIn,
      punchOut: entry.clockOut,
      durationMinutes: getRawDurationMinutes(entry, now),
    });
  }

  return issues.sort(
    (issueA, issueB) =>
      issueA.workDate.localeCompare(issueB.workDate) ||
      issueA.employeeName.localeCompare(issueB.employeeName) ||
      issueA.label.localeCompare(issueB.label),
  );
}

export function formatPayrollExportIssue(issue: PayrollExportIssue): string {
  const when = issue.workDate !== 'No clock-in date' ? format(new Date(`${issue.workDate}T12:00:00`), 'EEE, MMM d') : issue.workDate;
  const punchIn = issue.punchIn ? format(new Date(issue.punchIn), 'p') : '—';
  const punchOut = issue.punchOut ? format(new Date(issue.punchOut), 'p') : 'still open';
  return `${issue.employeeName} (#${issue.employeeNumber}) · ${when} · ${issue.label} · ${punchIn} – ${punchOut} · ${formatDuration(issue.durationMinutes)}`;
}

export function formatPayrollFlags(flags: string[]): string {
  return flags.join('; ');
}

export function summarizeEmployeePayrollFlags(rows: { flags?: string }[]): string {
  let active = 0;
  let longShift = 0;
  for (const row of rows) {
    if (!row.flags) continue;
    if (row.flags.includes(PAYROLL_FLAG_ACTIVE)) active += 1;
    if (row.flags.includes(PAYROLL_FLAG_LONG_SHIFT)) longShift += 1;
  }
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} active`);
  if (longShift > 0) parts.push(`${longShift} over ${LONG_SHIFT_HOURS}h`);
  return parts.join(', ');
}

export function countPayrollFlaggedRows(rows: { flags?: string }[]): number {
  return rows.filter((row) => Boolean(row.flags)).length;
}
