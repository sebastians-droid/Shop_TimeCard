import { useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, endOfWeek, startOfDay } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight, Phone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useScheduleList, useUpsertSchedule, type MechanicScheduleRow } from '@/hooks/use-shop-data';
import type { AppShopEmployee } from '@/lib/shop-employees';
import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { getPtoHours, isPtoEntry } from '@/lib/time-rules';
import { getEntryWorkDateKey } from '@/lib/entry-helpers';
import { ShopTimeEntryPTOTypeKeyToLabel } from '@/models/shop-time-entry';

type MechanicScheduleProps = {
  employees: AppShopEmployee[];
  timeEntries: ShopTimeEntry[];
};

export function MechanicSchedule({ employees, timeEntries }: MechanicScheduleProps) {
  const [weekDate, setWeekDate] = useState(() => startOfDay(new Date()));
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 0 });
  const weekLabel = `${format(weekStart, 'M/d/yyyy')} - ${format(weekEnd, 'M/d/yyyy')}`;
  const dayDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayKeys = dayDates.map((d) => format(d, 'yyyy-MM-dd'));

  const from = format(weekStart, "yyyy-MM-dd'T'00:00:00'Z'");
  const to = format(weekEnd, "yyyy-MM-dd'T'23:59:59'Z'");
  const { data: schedules = [], isLoading: schedulesLoading } = useScheduleList(from, to);
  const upsertSchedule = useUpsertSchedule();

  const scheduleMap = useMemo(() => {
    const map = new Map<string, MechanicScheduleRow>();
    for (const s of schedules) {
      if (s.employeeId && s.scheduleDate) {
        const dateKey = s.scheduleDate.slice(0, 10);
        map.set(`${s.employeeId}-${dateKey}`, s);
      }
    }
    return map;
  }, [schedules]);

  const ptoMap = useMemo(() => {
    const map = new Map<string, ShopTimeEntry[]>();
    for (const entry of timeEntries) {
      if (!isPtoEntry(entry)) continue;
      const empId = entry.employee?.id;
      if (!empId) continue;
      const dayKey = getEntryWorkDateKey(entry);
      const key = `${empId}-${dayKey}`;
      const existing = map.get(key) ?? [];
      existing.push(entry);
      map.set(key, existing);
    }
    return map;
  }, [timeEntries]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    [employees],
  );

  const handleSaveField = (employeeId: string, empNum: number | undefined, dayKey: string, field: 'scheduledStart' | 'onCall', value: string | boolean) => {
    const existing = scheduleMap.get(`${employeeId}-${dayKey}`);
    const scheduleKey = `${empNum ?? employeeId.slice(0, 8)}-${dayKey}`;
    upsertSchedule.mutate({
      scheduleKey,
      employeeId,
      scheduleDate: `${dayKey}T00:00:00Z`,
      scheduledStart: field === 'scheduledStart' ? (value as string) : existing?.scheduledStart,
      onCall: field === 'onCall' ? (value as boolean) : existing?.onCall,
    });
  };

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl"><CalendarIcon className="h-5 w-5" /> Mechanic Schedule</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{weekLabel} &middot; Set start times and on-call for each employee.</p>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1 text-card-foreground">
            <Button type="button" variant="ghost" size="icon" aria-label="Previous week" onClick={() => setWeekDate((d) => addWeeks(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="min-w-56 justify-start bg-background">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {weekLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={weekDate} onSelect={(d) => { if (d) setWeekDate(startOfDay(d)); }} initialFocus />
              </PopoverContent>
            </Popover>
            <Button type="button" variant="ghost" size="icon" aria-label="Next week" onClick={() => setWeekDate((d) => addWeeks(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {schedulesLoading ? <p className="text-sm text-muted-foreground">Loading schedule...</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="sticky left-0 bg-card px-3 py-2 font-semibold">Employee</th>
                {dayDates.map((d, i) => (
                  <th key={dayKeys[i]} className="px-2 py-2 text-center font-semibold">
                    <div>{format(d, 'EEE')}</div>
                    <div className="text-xs font-normal text-muted-foreground">{format(d, 'M/d')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map((emp) => (
                <tr key={emp.id} className="border-b border-border last:border-0">
                  <td className="sticky left-0 bg-card px-3 py-2 font-medium whitespace-nowrap">
                    <div>{emp.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{emp.employeeCode}</div>
                  </td>
                  {dayKeys.map((dayKey) => {
                    const cellKey = `${emp.id}-${dayKey}`;
                    const sched = scheduleMap.get(cellKey);
                    const ptoEntries = ptoMap.get(cellKey);
                    return (
                      <td key={dayKey} className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-1.5">
                          <Input
                            type="time"
                            className="h-8 w-full min-w-[5rem] bg-background text-xs"
                            defaultValue={sched?.scheduledStart ?? ''}
                            onBlur={(e) => {
                              const val = e.target.value;
                              if (val !== (sched?.scheduledStart ?? '')) {
                                handleSaveField(emp.id, emp.employeeCode, dayKey, 'scheduledStart', val);
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveField(emp.id, emp.employeeCode, dayKey, 'onCall', !sched?.onCall)}
                            className={`flex items-center justify-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${sched?.onCall ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                          >
                            <Phone className="h-3 w-3" />
                            {sched?.onCall ? 'On Call' : 'Off'}
                          </button>
                          {ptoEntries?.map((pto) => (
                            <Badge key={pto.id} variant="secondary" className="justify-center text-xs">
                              {getPtoHours(pto)}h {pto.pTOTypeKey ? ShopTimeEntryPTOTypeKeyToLabel[pto.pTOTypeKey] : 'PTO'}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
