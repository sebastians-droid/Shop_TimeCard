import { useMemo, useState } from 'react';
import { eachDayOfInterval, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon, ChevronDown, Clock, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAllEquipmentAssets, useShopEmployeeList, useShopTimeEntryList } from '@/hooks/use-shop-data';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import { formatDuration, getDayPayMinutes, getEntryPaidMinutes, getPtoHours, isPtoEntry } from '@/lib/time-rules';
import { getTimeEntryAssetName, getEntryJobNumber } from '@/lib/entry-helpers';
import { divisionLabel } from '@/lib/reference-data';
import {
  ShopTimeEntryPayTypeKeyToLabel,
  ShopTimeEntryPTOTypeKeyToLabel,
  type ShopTimeEntry,
} from '@/models/shop-time-entry';

function computeRtOt(dayEntries: ShopTimeEntry[]): { rt: number; ot: number } {
  const RT_THRESHOLD_HOURS = 8;
  let accumulated = 0;
  let totalRt = 0;
  let totalOt = 0;
  for (const entry of dayEntries) {
    const hours = getEntryPaidMinutes(dayEntries, entry) / 60;
    if (isPtoEntry(entry)) {
      totalRt += hours;
      continue;
    }
    const rtRemaining = Math.max(0, RT_THRESHOLD_HOURS - accumulated);
    const rt = Math.min(hours, rtRemaining);
    const ot = Math.max(0, hours - rt);
    totalRt += rt;
    totalOt += ot;
    accumulated += hours;
  }
  return { rt: Math.round(totalRt * 100) / 100, ot: Math.round(totalOt * 100) / 100 };
}

export default function MechanicLogPage() {
  const [employeeCode, setEmployeeCode] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfWeek(now, { weekStartsOn: 0 }),
    to: endOfWeek(now, { weekStartsOn: 0 }),
  });

  const { data: shopEmployees = [], isLoading: employeesLoading, isError: employeesFailed, error: employeesError, refetch: refetchEmployees } = useShopEmployeeList();
  const employees = useMemo(() => mapShopEmployees(shopEmployees), [shopEmployees]);
  const { data: assets = [] } = useAllEquipmentAssets();
  const { data: timeEntries = [] } = useShopTimeEntryList();

  const selectedEmployee = employees.find((e: AppShopEmployee) => e.id === selectedEmployeeId);

  const handleEmployeeCodeSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const matched = employees.find((e: AppShopEmployee) => e.employeeCode === Number(employeeCode.trim()));
    if (!matched) {
      setSelectedEmployeeId('');
      toast.error('Employee code not found. Enter your 4 digit employee number.');
      return;
    }
    setSelectedEmployeeId(matched.id);
    toast.success(`Verified ${matched.employeeName}.`);
  };

  const handleResetEmployee = () => {
    setEmployeeCode('');
    setSelectedEmployeeId('');
  };

  const setQuickRange = (from: Date, to: Date) => {
    setDateRange({ from, to });
  };

  const filteredEntries = useMemo(() => {
    if (!selectedEmployee || !dateRange?.from || !dateRange?.to) return [];
    const from = dateRange.from.getTime();
    const to = dateRange.to.getTime() + 86400000 - 1;
    return timeEntries
      .filter((entry: ShopTimeEntry) => {
        if (entry.employee?.id !== selectedEmployee.id) return false;
        if (!entry.clockIn) return false;
        const t = new Date(entry.clockIn).getTime();
        return t >= from && t <= to;
      })
      .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
  }, [selectedEmployee, dateRange, timeEntries]);

  const days = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    return eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
  }, [dateRange]);

  const dayData = useMemo(() => {
    return days.map((day) => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const entries = filteredEntries.filter(
        (entry: ShopTimeEntry) => entry.clockIn?.startsWith(dateKey),
      );
      const dayPay = getDayPayMinutes(entries);
      const { rt, ot } = computeRtOt(entries);
      const totalHours = dayPay.totalMinutes / 60;
      return { day, dateKey, entries, totalHours, rt, ot, dayPay };
    });
  }, [days, filteredEntries]);

  const rangeTotals = useMemo(() => {
    let total = 0;
    let rt = 0;
    let ot = 0;
    for (const d of dayData) {
      total += d.totalHours;
      rt += d.rt;
      ot += d.ot;
    }
    return {
      total: Math.round(total * 100) / 100,
      rt: Math.round(rt * 100) / 100,
      ot: Math.round(ot * 100) / 100,
    };
  }, [dayData]);

  const assetSummary = useMemo(() => {
    const map = new Map<string, { name: string; total: number; rt: number; ot: number }>();
    for (const d of dayData) {
      for (const entry of d.entries) {
        const name = getTimeEntryAssetName(entry, assets);
        const hours = getEntryPaidMinutes(d.entries, entry) / 60;
        const existing = map.get(name) ?? { name, total: 0, rt: 0, ot: 0 };
        existing.total += hours;
        map.set(name, existing);
      }
    }
    for (const d of dayData) {
      const { rt: dayRt, ot: dayOt } = d;
      const dayTotal = d.totalHours;
      if (dayTotal <= 0) continue;
      for (const entry of d.entries) {
        const name = getTimeEntryAssetName(entry, assets);
        const hours = getEntryPaidMinutes(d.entries, entry) / 60;
        const fraction = hours / dayTotal;
        const existing = map.get(name);
        if (existing) {
          existing.rt += dayRt * fraction;
          existing.ot += dayOt * fraction;
        }
      }
    }
    return [...map.values()]
      .map((v) => ({
        ...v,
        total: Math.round(v.total * 100) / 100,
        rt: Math.round(v.rt * 100) / 100,
        ot: Math.round(v.ot * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total);
  }, [dayData, assets]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {!selectedEmployee ? (
        <Card className="bg-card text-card-foreground shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Search className="h-5 w-5" /> Sign in
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="mx-auto grid max-w-sm gap-3" onSubmit={handleEmployeeCodeSubmit}>
              <Label htmlFor="mechanic-code">Employee code</Label>
              <Input
                id="mechanic-code"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]*"
                type="password"
                value={employeeCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmployeeCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="****"
              />
              {employeesFailed ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">Could not load shop employees from Dataverse.</p>
                  <p className="mt-1 break-words text-destructive/80">
                    {employeesError instanceof Error ? employeesError.message : 'Grant the app user Read on Shop Employee, then retry.'}
                  </p>
                  <Button type="button" variant="outline" className="mt-3" onClick={() => void refetchEmployees()}>Retry</Button>
                </div>
              ) : null}
              <Button className="h-12" type="submit" disabled={employeesLoading || employeesFailed || employeeCode.trim().length === 0}>
                View my work log
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-6">
          {/* Employee header */}
          <Card className="bg-card text-card-foreground shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-xl">{selectedEmployee.employeeName}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Employee {selectedEmployee.employeeCode} · Mechanic Log
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={handleResetEmployee}>Change employee</Button>
              </div>
            </CardHeader>
          </Card>

          {/* Date range picker */}
          <Card className="bg-card text-card-foreground shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarIcon className="h-5 w-5" /> Date Range
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuickRange(startOfWeek(now, { weekStartsOn: 0 }), endOfWeek(now, { weekStartsOn: 0 }))}
                >
                  This Week
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const lastWeek = subWeeks(now, 1);
                    setQuickRange(startOfWeek(lastWeek, { weekStartsOn: 0 }), endOfWeek(lastWeek, { weekStartsOn: 0 }));
                  }}
                >
                  Last Week
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const twoWeeksAgo = subWeeks(now, 2);
                    setQuickRange(startOfWeek(twoWeeksAgo, { weekStartsOn: 0 }), endOfWeek(subWeeks(now, 1), { weekStartsOn: 0 }));
                  }}
                >
                  Last 2 Weeks
                </Button>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-start text-left font-normal sm:w-auto">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}`
                      ) : (
                        format(dateRange.from, 'MMM d, yyyy')
                      )
                    ) : (
                      'Pick a date range'
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          {/* Weekly summary */}
          <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted px-3 py-3">
                  <p className="text-xs text-muted-foreground">Total Hours</p>
                  <p className="text-2xl font-bold text-foreground">{rangeTotals.total.toFixed(1)}</p>
                </div>
                <div className="rounded-md bg-muted px-3 py-3">
                  <p className="text-xs text-muted-foreground">RT Hours</p>
                  <p className="text-2xl font-bold text-foreground">{rangeTotals.rt.toFixed(1)}</p>
                </div>
                <div className="rounded-md bg-muted px-3 py-3">
                  <p className="text-xs text-muted-foreground">OT Hours</p>
                  <p className="text-2xl font-bold text-primary">{rangeTotals.ot.toFixed(1)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Daily breakdowns */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Daily Breakdown</h2>
            {dayData.filter((d) => d.entries.length > 0).length === 0 ? (
              <Card className="bg-card text-card-foreground shadow-sm">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No time entries found for this date range.
                </CardContent>
              </Card>
            ) : (
              dayData
                .filter((d) => d.entries.length > 0)
                .map((d) => (
                  <Collapsible key={d.dateKey} defaultOpen>
                    <Card className="bg-card text-card-foreground shadow-sm">
                      <CollapsibleTrigger className="w-full text-left">
                        <CardHeader className="cursor-pointer">
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <CardTitle className="text-base">{format(d.day, 'EEEE, MMM d')}</CardTitle>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {d.entries.length} {d.entries.length === 1 ? 'entry' : 'entries'}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex gap-3 text-sm">
                                <span className="font-semibold">{d.totalHours.toFixed(1)}h</span>
                                <span className="text-muted-foreground">RT {d.rt.toFixed(1)}</span>
                                {d.ot > 0 && <span className="font-medium text-primary">OT {d.ot.toFixed(1)}</span>}
                              </div>
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]>*>&]:rotate-180" />
                            </div>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="space-y-2 border-t border-border pt-4">
                          {d.entries.map((entry: ShopTimeEntry) => {
                            const paidMinutes = getEntryPaidMinutes(d.entries, entry);
                            const assetName = getTimeEntryAssetName(entry, assets);
                            const jobNum = getEntryJobNumber(entry);
                            const div = entry.assetDivision != null ? divisionLabel(entry.assetDivision) : '';
                            return (
                              <div key={entry.id} className="rounded-lg border border-border bg-background p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0 space-y-1">
                                    <p className="font-semibold text-foreground">{assetName}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                                      <Clock className="h-3.5 w-3.5" />
                                      <span>{entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'}</span>
                                      <span>–</span>
                                      <span>{entry.clockOut ? format(new Date(entry.clockOut), 'p') : '—'}</span>
                                      <span className="mx-1">·</span>
                                      <span className="font-medium text-foreground">{formatDuration(paidMinutes)}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                                      {div && <span>Div {div}</span>}
                                      {div && jobNum && <span>·</span>}
                                      {jobNum && <span>Job {jobNum}</span>}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {entry.payTypeKey && entry.payTypeKey in ShopTimeEntryPayTypeKeyToLabel && (
                                      <Badge variant="outline">
                                        {ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey]}
                                      </Badge>
                                    )}
                                    {isPtoEntry(entry) && (
                                      <Badge variant="secondary">PTO {getPtoHours(entry)}h</Badge>
                                    )}
                                    {entry.pTOTypeKey && entry.pTOTypeKey in ShopTimeEntryPTOTypeKeyToLabel && (
                                      <Badge variant="outline">
                                        {ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}
                                      </Badge>
                                    )}
                                    {entry.onCall && <Badge variant="secondary">On Call</Badge>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ))
            )}
          </div>

          {/* Asset summary table */}
          {assetSummary.length > 0 && (
            <Card className="bg-card text-card-foreground shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Hours by Asset</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Asset</th>
                        <th className="pb-2 px-4 text-right font-medium">Total</th>
                        <th className="pb-2 px-4 text-right font-medium">RT</th>
                        <th className="pb-2 pl-4 text-right font-medium">OT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetSummary.map((row) => (
                        <tr key={row.name} className="border-b border-border last:border-0">
                          <td className="py-2 pr-4 font-medium text-foreground">{row.name}</td>
                          <td className="py-2 px-4 text-right tabular-nums">{row.total.toFixed(1)}</td>
                          <td className="py-2 px-4 text-right tabular-nums">{row.rt.toFixed(1)}</td>
                          <td className="py-2 pl-4 text-right tabular-nums text-primary">{row.ot.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </main>
  );
}
