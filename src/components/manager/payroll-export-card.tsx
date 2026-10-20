import { useState } from 'react';
import { addDays, addWeeks, format } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from '@/lib/toast';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { startOfDay } from 'date-fns';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { buildPayrollWorkbookBlob, type PayrollEmployeeExport } from '@/lib/payroll-workbook';
import {
  collectPayrollExportIssues,
  formatPayrollExportIssue,
  formatPayrollFlags,
  LONG_SHIFT_HOURS,
  payrollEntryFlags,
  summarizeEmployeePayrollFlags,
  type PayrollExportIssue,
} from '@/lib/payroll-flags';
import {
  DEFAULT_SCHEDULED_START,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  isPtoEntry,
  lunchCsvLabel,
  scheduledStartFor,
  isAwaitingAsset,
} from '@/lib/time-rules';
import {
  getEntryAssetName,
  getEntryDivision,
  getEntryEmployeeKey,
  getEntryEmployeeName,
  getEntryEmployeeNumber,
  getEntryJobNumber,
  getEntryWorkDateKey,
  getEmployeeNotes,
  getWeekRange,
  formatWeekRangeLabel,
  entriesForPayrollExport,
  PAYROLL_AWAITING_LABEL,
} from '@/lib/entry-helpers';
import {
  ShopTimeEntryPayTypeKeyToLabel,
  ShopTimeEntryPTOTypeKeyToLabel,
  DEFAULT_PAY_TYPE,
  type ShopTimeEntry,
} from '@/models/shop-time-entry';
import { entryDistanceMiles } from '@/lib/geolocation';
import type { MechanicScheduleRow } from '@/hooks/use-shop-data';

type PayrollExportCardProps = {
  exportWeekDate: Date;
  onExportWeekDateChange: React.Dispatch<React.SetStateAction<Date>>;
  weeklyEntries: ShopTimeEntry[];
  weeklyPayrollMinutes: number;
  employees: AppShopEmployee[];
  assets: EquipmentAsset[];
  schedules?: MechanicScheduleRow[];
};

function IssueList({ title, issues }: { title: string; issues: PayrollExportIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section className="space-y-2">
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={`${issue.workDate}-${issue.employeeNumber}-${issue.label}-${issue.kinds.join(',')}`} className="rounded-md bg-muted px-3 py-2 text-foreground">
            {formatPayrollExportIssue(issue)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PayrollExportCard({
  exportWeekDate,
  onExportWeekDateChange,
  weeklyEntries,
  weeklyPayrollMinutes,
  employees,
  assets,
  schedules = [],
}: PayrollExportCardProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingIssues, setPendingIssues] = useState<PayrollExportIssue[]>([]);

  const exportWeekRange = getWeekRange(exportWeekDate);

  const scheduleMap = new Map<string, string | undefined>();
  for (const s of schedules) {
    if (s.employeeId && s.scheduleDate) {
      scheduleMap.set(`${s.employeeId}-${s.scheduleDate.slice(0, 10)}`, s.scheduledStart);
    }
  }

  const buildPayrollEmployees = (): PayrollEmployeeExport[] => {
    const dayKeys = Array.from({ length: 7 }, (_value, index) => format(addDays(exportWeekRange.start, index), 'yyyy-MM-dd'));
    const entriesByEmployee = new Map<string, ShopTimeEntry[]>();
    weeklyEntries.forEach((entry: ShopTimeEntry) => {
      const employeeKey = getEntryEmployeeKey(entry);
      const currentEntries = entriesByEmployee.get(employeeKey) ?? [];
      currentEntries.push(entry);
      entriesByEmployee.set(employeeKey, currentEntries);
    });

    return Array.from(entriesByEmployee.entries())
      .map(([employeeKey, entries]: [string, ShopTimeEntry[]]) => {
        const firstEntry = entries[0];
        const employeeName = firstEntry ? getEntryEmployeeName(firstEntry, employees) : 'Unknown employee';
        const employeeNumber = firstEntry ? getEntryEmployeeNumber(firstEntry, employees) : employeeKey;
        const sortedEntries = [...entries].sort(
          (entryA: ShopTimeEntry, entryB: ShopTimeEntry) =>
            new Date(entryA.clockIn ?? '').getTime() - new Date(entryB.clockIn ?? '').getTime(),
        );
        const entriesByDay = new Map<string, ShopTimeEntry[]>();
        sortedEntries.forEach((entry: ShopTimeEntry) => {
          const dayKey = getEntryWorkDateKey(entry);
          const dayEntries = entriesByDay.get(dayKey) ?? [];
          dayEntries.push(entry);
          entriesByDay.set(dayKey, dayEntries);
        });
        const empId = firstEntry?.employee?.id;
        const employee = empId ? employees.find((candidate) => candidate.id === empId) : undefined;
        const dayHours = dayKeys.map((dayKey) => {
          const scheduled = scheduledStartFor(employee, empId ? scheduleMap.get(`${empId}-${dayKey}`) : undefined);
          return getDayPayMinutes(entriesByDay.get(dayKey) ?? [], undefined, scheduled, {
            isRoadMech: employee?.isRoadMech,
            isAdmin: employee?.isAdmin,
            isPartsRunner: employee?.isPartsRunner,
          }).totalMinutes;
        });
        const noLunchDays = dayKeys.flatMap((dayKey, index) => {
          const pay = getDayPayMinutes(entriesByDay.get(dayKey) ?? []);
          return pay.noLunch ? [format(addDays(exportWeekRange.start, index), 'EEE M/d')] : [];
        });
        const rows = entriesForPayrollExport(sortedEntries).map((entry: ShopTimeEntry) => {
          const dayEntries = entriesByDay.get(getEntryWorkDateKey(entry)) ?? [entry];
          const dayScheduled = scheduledStartFor(employee, empId ? scheduleMap.get(`${empId}-${getEntryWorkDateKey(entry)}`) : undefined);
          const awaiting = isAwaitingAsset(entry);
          const flags = formatPayrollFlags(payrollEntryFlags(entry));
          return {
            workDate: getEntryWorkDateKey(entry),
            punchIn: entry.clockIn ? format(new Date(entry.clockIn), 'M/d/yyyy p') : '',
            punchOut: entry.clockOut ? format(new Date(entry.clockOut), 'M/d/yyyy p') : '',
            hours: awaiting
              ? 0
              : Math.round(
                  (getEntryPaidMinutes(dayEntries, entry, undefined, dayScheduled, {
                    isRoadMech: employee?.isRoadMech,
                    isAdmin: employee?.isAdmin,
                    isPartsRunner: employee?.isPartsRunner,
                  }) /
                    60) *
                    100,
                ) / 100,
            lunch: isPtoEntry(entry) || awaiting ? '' : lunchCsvLabel(dayEntries),
            ptoTime: isPtoEntry(entry) ? `${getPtoHours(entry)} hours` : '',
            ptoType: entry.pTOTypeKey ? ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey] : '',
            division: awaiting ? '' : getEntryDivision(entry, assets) || 'Unassigned',
            asset: awaiting ? PAYROLL_AWAITING_LABEL : getEntryAssetName(entry, assets),
            jobNumber: awaiting ? '' : getEntryJobNumber(entry) || '',
            payType: isPtoEntry(entry) || awaiting ? '' : ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey ?? DEFAULT_PAY_TYPE],
            status: entry.clockOut ? 'Complete' : 'Active',
            flags,
            notes: getEmployeeNotes(entry.notes),
            scheduledStart: employee?.isAdmin
              ? 'Admin'
              : employee?.isRoadMech
                ? 'Road mechanic'
                : (dayScheduled ?? DEFAULT_SCHEDULED_START),
            clockInDistance: entryDistanceMiles(entry.clockInLat, entry.clockInLon),
            clockOutDistance: entryDistanceMiles(entry.clockOutLat, entry.clockOutLon),
          };
        });
        return {
          name: employeeName,
          number: employeeNumber,
          dayHours,
          noLunchDays,
          weekHours: dayHours.reduce((total, minutes) => total + minutes, 0),
          reviewFlags: summarizeEmployeePayrollFlags(rows),
          rows,
        };
      })
      .sort((employeeA, employeeB) => employeeA.name.localeCompare(employeeB.name) || employeeA.number.localeCompare(employeeB.number));
  };

  const performExport = async () => {
    setIsExporting(true);
    try {
      const payrollEmployees = buildPayrollEmployees();
      const blob = await buildPayrollWorkbookBlob({
        weekStart: exportWeekRange.start,
        weekEnd: exportWeekRange.end,
        employees: payrollEmployees,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `timecards-${format(exportWeekRange.start, 'yyyy-MM-dd')}-to-${format(exportWeekRange.end, 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(
        `Excel workbook exported for ${payrollEmployees.length} employee${payrollEmployees.length === 1 ? '' : 's'} · ${formatWeekRangeLabel(exportWeekDate)}.`,
      );
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to export the Excel workbook.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWeeklyPayroll = () => {
    if (weeklyEntries.length === 0) {
      toast.info(`No time entries are available for ${formatWeekRangeLabel(exportWeekDate)}.`);
      return;
    }

    const issues = collectPayrollExportIssues(weeklyEntries, employees, assets);
    if (issues.length > 0) {
      setPendingIssues(issues);
      setReviewOpen(true);
      return;
    }

    void performExport();
  };

  const handleConfirmExport = () => {
    setReviewOpen(false);
    setPendingIssues([]);
    void performExport();
  };

  const activeIssues = pendingIssues.filter((issue) => issue.kinds.includes('active'));
  const longShiftIssues = pendingIssues.filter((issue) => issue.kinds.includes('long-shift'));
  const autoClockOutIssues = pendingIssues.filter((issue) => issue.kinds.includes('auto-clock-out'));

  return (
    <>
      <Card className="bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Download className="h-5 w-5" /> Weekly timecard export
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a Sunday-Saturday payroll week, then export one Excel workbook. Open punches or shifts over 12 hours require confirmation first.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleExportWeeklyPayroll}
              disabled={weeklyEntries.length === 0 || isExporting}
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" /> {isExporting ? 'Building Excel…' : `Export ${formatWeekRangeLabel(exportWeekDate)} Excel`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Export week</p>
              <p className="text-sm text-muted-foreground">
                {formatWeekRangeLabel(exportWeekDate)} · {weeklyEntries.length} entries · {formatDuration(weeklyPayrollMinutes)}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1 text-card-foreground">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous export week"
                onClick={() => onExportWeekDateChange((currentDate: Date) => addWeeks(currentDate, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="min-w-56 justify-start bg-background">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formatWeekRangeLabel(exportWeekDate)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={exportWeekDate}
                    onSelect={(date: Date | undefined) => {
                      if (date) {
                        onExportWeekDateChange(startOfDay(date));
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next export week"
                onClick={() => onExportWeekDateChange((currentDate: Date) => addWeeks(currentDate, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Review timecards before exporting</AlertDialogTitle>
            <AlertDialogDescription>
              {formatWeekRangeLabel(exportWeekDate)} has {pendingIssues.length}{' '}
              {pendingIssues.length === 1 ? 'entry' : 'entries'} that still need attention. Export only after reviewing these punches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-72 space-y-4 overflow-y-auto text-sm">
            <IssueList title="Still open (no clock-out)" issues={activeIssues} />
            <IssueList title="Closed automatically after 16 hours" issues={autoClockOutIssues} />
            <IssueList title={`Over ${LONG_SHIFT_HOURS} hours on one punch`} issues={longShiftIssues} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingIssues([])}>Cancel</AlertDialogCancel>
            <Button type="button" onClick={handleConfirmExport} disabled={isExporting}>
              Export anyway
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
