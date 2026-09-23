import { useState } from 'react';
import { addDays, addWeeks, format } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { startOfDay } from 'date-fns';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { buildPayrollWorkbookBlob } from '@/lib/payroll-workbook';
import {
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  isPtoEntry,
  lunchCsvLabel,
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
} from '@/lib/entry-helpers';
import { ShopTimeEntryPayTypeKeyToLabel, ShopTimeEntryPTOTypeKeyToLabel, DEFAULT_PAY_TYPE, type ShopTimeEntry } from '@/models/shop-time-entry';

type PayrollExportCardProps = {
  exportWeekDate: Date;
  onExportWeekDateChange: React.Dispatch<React.SetStateAction<Date>>;
  weeklyEntries: ShopTimeEntry[];
  weeklyPayrollMinutes: number;
  employees: AppShopEmployee[];
  assets: EquipmentAsset[];
};

export function PayrollExportCard({ exportWeekDate, onExportWeekDateChange, weeklyEntries, weeklyPayrollMinutes, employees, assets }: PayrollExportCardProps) {
  const [isExporting, setIsExporting] = useState(false);

  const exportWeekRange = getWeekRange(exportWeekDate);

  const handleExportWeeklyPayroll = async () => {
    if (weeklyEntries.length === 0) {
      toast.info(`No time entries are available for ${formatWeekRangeLabel(exportWeekDate)}.`);
      return;
    }

    const dayKeys = Array.from({ length: 7 }, (_value, index) => format(addDays(exportWeekRange.start, index), 'yyyy-MM-dd'));
    const entriesByEmployee = new Map<string, ShopTimeEntry[]>();
    weeklyEntries.forEach((entry: ShopTimeEntry) => {
      const employeeKey = getEntryEmployeeKey(entry);
      const currentEntries = entriesByEmployee.get(employeeKey) ?? [];
      currentEntries.push(entry);
      entriesByEmployee.set(employeeKey, currentEntries);
    });

    const payrollEmployees = Array.from(entriesByEmployee.entries())
      .map(([employeeKey, entries]: [string, ShopTimeEntry[]]) => {
        const firstEntry = entries[0];
        const employeeName = firstEntry ? getEntryEmployeeName(firstEntry, employees) : 'Unknown employee';
        const employeeNumber = firstEntry ? getEntryEmployeeNumber(firstEntry, employees) : employeeKey;
        const sortedEntries = [...entries].sort((entryA: ShopTimeEntry, entryB: ShopTimeEntry) => new Date(entryA.clockIn ?? '').getTime() - new Date(entryB.clockIn ?? '').getTime());
        const entriesByDay = new Map<string, ShopTimeEntry[]>();
        sortedEntries.forEach((entry: ShopTimeEntry) => {
          const dayKey = getEntryWorkDateKey(entry);
          const dayEntries = entriesByDay.get(dayKey) ?? [];
          dayEntries.push(entry);
          entriesByDay.set(dayKey, dayEntries);
        });
        const dayHours = dayKeys.map((dayKey) => getDayPayMinutes(entriesByDay.get(dayKey) ?? []).totalMinutes);
        const noLunchDays = dayKeys.flatMap((dayKey, index) => {
          const pay = getDayPayMinutes(entriesByDay.get(dayKey) ?? []);
          return pay.noLunch ? [format(addDays(exportWeekRange.start, index), 'EEE M/d')] : [];
        });
        return {
          name: employeeName,
          number: employeeNumber,
          dayHours,
          noLunchDays,
          weekHours: dayHours.reduce((total, minutes) => total + minutes, 0),
          rows: sortedEntries.map((entry: ShopTimeEntry) => {
            const dayEntries = entriesByDay.get(getEntryWorkDateKey(entry)) ?? [entry];
            return {
              workDate: getEntryWorkDateKey(entry),
              punchIn: entry.clockIn ? format(new Date(entry.clockIn), 'M/d/yyyy p') : '',
              punchOut: entry.clockOut ? format(new Date(entry.clockOut), 'M/d/yyyy p') : '',
              hours: Math.round((getEntryPaidMinutes(dayEntries, entry) / 60) * 100) / 100,
              lunch: isPtoEntry(entry) ? '' : lunchCsvLabel(dayEntries),
              ptoTime: isPtoEntry(entry) ? `${getPtoHours(entry)} hours` : '',
              ptoType: entry.pTOTypeKey ? ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey] : '',
              division: getEntryDivision(entry, assets) || 'Unassigned',
              asset: getEntryAssetName(entry, assets),
              jobNumber: getEntryJobNumber(entry) || '',
              payType: isPtoEntry(entry) ? '' : ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey ?? DEFAULT_PAY_TYPE],
              status: entry.clockOut ? 'Complete' : 'Active',
              notes: getEmployeeNotes(entry.notes),
            };
          }),
        };
      })
      .sort((employeeA, employeeB) =>
        employeeA.name.localeCompare(employeeB.name) || employeeA.number.localeCompare(employeeB.number),
      );

    setIsExporting(true);
    try {
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
      toast.success(`Excel workbook exported for ${payrollEmployees.length} employee${payrollEmployees.length === 1 ? '' : 's'} · ${formatWeekRangeLabel(exportWeekDate)}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to export the Excel workbook.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl"><Download className="h-5 w-5" /> Weekly timecard export</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Choose a Sunday-Saturday payroll week, then export one Excel workbook.</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => void handleExportWeeklyPayroll()} disabled={weeklyEntries.length === 0 || isExporting} className="w-full sm:w-auto">
            <Download className="mr-2 h-4 w-4" /> {isExporting ? 'Building Excel…' : `Export ${formatWeekRangeLabel(exportWeekDate)} Excel`}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Export week</p>
            <p className="text-sm text-muted-foreground">{formatWeekRangeLabel(exportWeekDate)} · {weeklyEntries.length} entries · {formatDuration(weeklyPayrollMinutes)}</p>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1 text-card-foreground">
            <Button type="button" variant="ghost" size="icon" aria-label="Previous export week" onClick={() => onExportWeekDateChange((currentDate: Date) => addWeeks(currentDate, -1))}>
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
            <Button type="button" variant="ghost" size="icon" aria-label="Next export week" onClick={() => onExportWeekDateChange((currentDate: Date) => addWeeks(currentDate, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
