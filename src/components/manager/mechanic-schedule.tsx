import { useMemo, useState } from 'react';
import { eachDayOfInterval, format, startOfDay } from 'date-fns';
import { CalendarIcon, CalendarRange, ChevronDown, Copy, Phone, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { toast } from '@/lib/toast';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useScheduleList, useUpsertSchedule, type MechanicScheduleRow } from '@/hooks/use-shop-data';
import type { AppShopEmployee } from '@/lib/shop-employees';
import type { ShopTimeEntry } from '@/models/shop-time-entry';
import { getPtoHours, isPtoEntry } from '@/lib/time-rules';
import { getEntryWorkDateKey } from '@/lib/entry-helpers';
import { ShopTimeEntryPTOTypeKeyToLabel } from '@/models/shop-time-entry';

const DEFAULT_START = '07:00';

type MechanicScheduleProps = {
  employees: AppShopEmployee[];
  timeEntries: ShopTimeEntry[];
};

type ScheduleField = 'scheduledStart' | 'onCall';

type ScheduleFieldsProps = {
  empId: string;
  empNum: number | undefined;
  dk: string;
  startTime: string;
  onCall: boolean;
  showApplyAll: boolean;
  onSave: (empId: string, empNum: number | undefined, dk: string, field: ScheduleField, value: string | boolean) => void;
  onApplyAll: (empId: string, empNum: number | undefined, field: ScheduleField, value: string | boolean) => void | Promise<void>;
};

// Declared at module scope on purpose: nesting this inside MechanicSchedule gives
// it a new component identity on every parent render, which remounts the inputs
// and discards whatever the manager just typed.
function ScheduleFields({ empId, empNum, dk, startTime, onCall, showApplyAll, onSave, onApplyAll }: ScheduleFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Scheduled start</Label>
        <div className="flex gap-2">
          <Input
            type="time"
            className="bg-background"
            defaultValue={startTime}
            key={`${empId}-${dk}-${startTime}`}
            aria-label={`Scheduled start, ${format(new Date(`${dk}T00:00:00`), 'MMM d')}`}
            onKeyDown={(e) => {
              // Enter commits by releasing focus, which runs the same onBlur save.
              // Escape abandons the edit and restores the stored value.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.value = startTime;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const val = e.target.value;
              if (val && val !== startTime) onSave(empId, empNum, dk, 'scheduledStart', val);
            }}
          />
          {showApplyAll ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => onApplyAll(empId, empNum, 'scheduledStart', startTime)}
              title={`Apply ${startTime} to all days in range`}
            >
              <Copy className="mr-2 h-4 w-4" /> All days
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <Label>On Call</Label>
        <div className="flex gap-2">
          <div className="flex flex-1 overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => {
                if (!onCall) onSave(empId, empNum, dk, 'onCall', true);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${onCall ? 'bg-destructive text-white' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            >
              <Phone className="h-3.5 w-3.5" /> Yes
            </button>
            <button
              type="button"
              onClick={() => {
                if (onCall) onSave(empId, empNum, dk, 'onCall', false);
              }}
              className={`flex flex-1 items-center justify-center py-2 text-sm font-medium transition-colors ${!onCall ? 'bg-background text-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            >
              No
            </button>
          </div>
          {showApplyAll ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => onApplyAll(empId, empNum, 'onCall', onCall)}
              title={`Apply "${onCall ? 'On Call' : 'Off'}" to all days in range`}
            >
              <Copy className="mr-2 h-4 w-4" /> All days
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MechanicSchedule({ employees, timeEntries }: MechanicScheduleProps) {
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  // Range view state
  const [rangeEmployeeId, setRangeEmployeeId] = useState('');
  const [rangeViewRange, setRangeViewRange] = useState<DateRange | undefined>(undefined);
  const [rangeOpenDay, setRangeOpenDay] = useState('');

  const dayKey = format(selectedDate, 'yyyy-MM-dd');

  // Query the full month surrounding the selected date for single-day view,
  // and the range for range view — both covered by a wide window.
  const queryFrom = rangeViewRange?.from ? format(rangeViewRange.from, "yyyy-MM-dd'T'00:00:00'Z'") : `${dayKey}T00:00:00Z`;
  const queryTo = rangeViewRange?.to ? format(rangeViewRange.to, "yyyy-MM-dd'T'23:59:59'Z'") : `${dayKey}T23:59:59Z`;
  const { data: schedules = [], isLoading: schedulesLoading, error: schedulesError } = useScheduleList(queryFrom, queryTo);
  const upsertSchedule = useUpsertSchedule();

  const scheduleMap = useMemo(() => {
    const map = new Map<string, MechanicScheduleRow>();
    for (const s of schedules) {
      if (s.employeeId && s.scheduleDate) {
        map.set(`${s.employeeId}-${s.scheduleDate.slice(0, 10)}`, s);
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
      const key = `${empId}-${getEntryWorkDateKey(entry)}`;
      const existing = map.get(key) ?? [];
      existing.push(entry);
      map.set(key, existing);
    }
    return map;
  }, [timeEntries]);

  const sortedEmployees = useMemo(() => [...employees].sort((a, b) => a.employeeName.localeCompare(b.employeeName)), [employees]);

  const rangeEmployee = rangeEmployeeId ? (employees.find((e) => e.id === rangeEmployeeId) ?? null) : null;

  const rangeDays = useMemo(() => {
    if (!rangeViewRange?.from || !rangeViewRange?.to) return [];
    return eachDayOfInterval({ start: rangeViewRange.from, end: rangeViewRange.to });
  }, [rangeViewRange]);

  const getStart = (empId: string, dk: string) => scheduleMap.get(`${empId}-${dk}`)?.scheduledStart ?? DEFAULT_START;

  const getOnCall = (empId: string, dk: string) => scheduleMap.get(`${empId}-${dk}`)?.onCall === true;

  const handleSave = (
    empId: string,
    empNum: number | undefined,
    dk: string,
    field: 'scheduledStart' | 'onCall',
    value: string | boolean,
  ) => {
    const existing = scheduleMap.get(`${empId}-${dk}`);
    upsertSchedule.mutate(
      {
        scheduleKey: `${empNum ?? empId.slice(0, 8)}-${dk}`,
        employeeId: empId,
        scheduleDate: `${dk}T00:00:00Z`,
        scheduledStart: field === 'scheduledStart' ? (value as string) : (existing?.scheduledStart ?? DEFAULT_START),
        onCall: field === 'onCall' ? (value as boolean) : existing?.onCall,
      },
      {
        // Confirm only once the server accepted it, so a rejected save shows the
        // hook's error toast rather than a success message it would contradict.
        onSuccess: () => {
          const when = format(new Date(`${dk}T00:00:00`), 'MMM d');
          toast.success(
            field === 'scheduledStart' ? `Start time saved for ${when} — ${value}.` : `On call ${value ? 'set' : 'cleared'} for ${when}.`,
          );
        },
      },
    );
  };

  const handleApplyAllDays = async (
    empId: string,
    empNum: number | undefined,
    field: 'scheduledStart' | 'onCall',
    value: string | boolean,
  ) => {
    const days = rangeDays.length > 0 ? rangeDays.map((d) => format(d, 'yyyy-MM-dd')) : [dayKey];
    const results = await Promise.allSettled(
      days.map((dk) => {
        const existing = scheduleMap.get(`${empId}-${dk}`);
        return upsertSchedule.mutateAsync({
          scheduleKey: `${empNum ?? empId.slice(0, 8)}-${dk}`,
          employeeId: empId,
          scheduleDate: `${dk}T00:00:00Z`,
          scheduledStart: field === 'scheduledStart' ? (value as string) : (existing?.scheduledStart ?? DEFAULT_START),
          onCall: field === 'onCall' ? (value as boolean) : existing?.onCall,
        });
      }),
    );
    // One summary instead of a toast per day; the hook already reports each failure.
    const saved = results.filter((r) => r.status === 'fulfilled').length;
    const label = field === 'scheduledStart' ? `Start time ${value}` : `On call ${value ? 'on' : 'off'}`;
    if (saved === days.length) toast.success(`${label} applied to ${saved} ${saved === 1 ? 'day' : 'days'}.`);
    else toast.warning(`${label} applied to ${saved} of ${days.length} days.`);
  };

  const toggleOpen = (key: string) => setOpenKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const showApplyAll = rangeDays.length > 1;

  // ── Range view (one employee) ──

  if (rangeEmployeeId) {
    return (
      <Card className="bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarRange className="h-5 w-5" /> {rangeEmployee?.employeeName ?? 'Employee'} — Schedule
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Employee {rangeEmployee?.employeeCode} &middot; Set start times and on-call for a date range.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={rangeEmployeeId}
                onValueChange={(v) => {
                  setRangeEmployeeId(v);
                  setRangeOpenDay('');
                }}
              >
                <SelectTrigger className="w-auto min-w-48 bg-background">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {sortedEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.employeeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="justify-start bg-background">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {rangeViewRange?.from && rangeViewRange?.to
                        ? `${format(rangeViewRange.from, 'MMM d')} – ${format(rangeViewRange.to, 'MMM d, yyyy')}`
                        : rangeViewRange?.from
                          ? `${format(rangeViewRange.from, 'MMM d, yyyy')} – …`
                          : 'Pick a date range'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="range"
                      selected={rangeViewRange}
                      onSelect={(range: DateRange | undefined) => {
                        setRangeViewRange(range);
                        setRangeOpenDay('');
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRangeEmployeeId('');
                    setRangeViewRange(undefined);
                    setRangeOpenDay('');
                  }}
                >
                  <X className="mr-2 h-4 w-4" /> Close
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {schedulesLoading ? <p className="text-sm text-muted-foreground">Loading schedule...</p> : null}
          {schedulesError ? (
            <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Saved schedules could not be loaded, so every start time below is showing the {DEFAULT_START} default rather than what is
              stored. Changes will not save until this is resolved.
              {schedulesError instanceof Error ? ` (${schedulesError.message})` : null}
            </p>
          ) : null}
          {!rangeViewRange?.from ? (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Use the date picker above to select a range of days.</p>
          ) : !rangeViewRange?.to ? (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Click a second date to complete the range.</p>
          ) : null}

          {rangeDays.map((day) => {
            const dk = format(day, 'yyyy-MM-dd');
            const startTime = getStart(rangeEmployeeId, dk);
            const onCall = getOnCall(rangeEmployeeId, dk);
            const ptoEntries = ptoMap.get(`${rangeEmployeeId}-${dk}`);
            const isOpen = rangeOpenDay === dk;

            return (
              <Collapsible key={dk} open={isOpen} onOpenChange={() => setRangeOpenDay(isOpen ? '' : dk)} asChild>
                <section className="rounded-lg border border-border bg-background">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between p-3 text-left">
                      <div>
                        <p className="font-semibold text-sm">{format(day, 'EEEE, MMM d')}</p>
                        <p className="text-xs text-muted-foreground">Start {startTime}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {onCall ? (
                          <Badge variant="destructive">
                            <Phone className="mr-1 h-3 w-3" /> On Call
                          </Badge>
                        ) : null}
                        {ptoEntries?.map((pto) => (
                          <Badge key={pto.id} variant="secondary" className="text-xs">
                            {getPtoHours(pto)}h {pto.pTOTypeKey ? `${ShopTimeEntryPTOTypeKeyToLabel[pto.pTOTypeKey]} PTO` : 'PTO'}
                          </Badge>
                        ))}
                        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-border px-4 py-3">
                      <ScheduleFields
                        empId={rangeEmployeeId}
                        empNum={rangeEmployee?.employeeCode}
                        dk={dk}
                        startTime={startTime}
                        onCall={onCall}
                        showApplyAll={showApplyAll}
                        onSave={handleSave}
                        onApplyAll={handleApplyAllDays}
                      />
                    </div>
                  </CollapsibleContent>
                </section>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  // ── Single-day view (default) ──

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CalendarIcon className="h-5 w-5" /> Mechanic Schedule
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {format(selectedDate, 'EEEE, MMM d')} &middot; Set start times and on-call.
            </p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="justify-start bg-background sm:w-56">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, 'MMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  if (d) {
                    setSelectedDate(startOfDay(d));
                    setOpenKeys([]);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {schedulesLoading ? <p className="text-sm text-muted-foreground">Loading schedule...</p> : null}
        {schedulesError ? (
          <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Saved schedules could not be loaded, so every start time below is showing the {DEFAULT_START} default rather than what is
            stored. Changes will not save until this is resolved.
            {schedulesError instanceof Error ? ` (${schedulesError.message})` : null}
          </p>
        ) : null}
        {sortedEmployees.map((emp) => {
          const startTime = getStart(emp.id, dayKey);
          const onCall = getOnCall(emp.id, dayKey);
          const ptoEntries = ptoMap.get(`${emp.id}-${dayKey}`);
          const isOpen = openKeys.includes(emp.id);

          return (
            <Collapsible key={emp.id} open={isOpen} onOpenChange={() => toggleOpen(emp.id)} asChild>
              <section className="rounded-lg border border-border bg-background">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left">
                    <div>
                      <p className="font-semibold">{emp.employeeName}</p>
                      <p className="text-sm text-muted-foreground">
                        Employee {emp.employeeCode} &middot; Start {startTime}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {onCall ? (
                        <Badge variant="destructive">
                          <Phone className="mr-1 h-3 w-3" /> On Call
                        </Badge>
                      ) : null}
                      {ptoEntries?.map((pto) => (
                        <Badge key={pto.id} variant="secondary" className="text-xs">
                          {getPtoHours(pto)}h {pto.pTOTypeKey ? `${ShopTimeEntryPTOTypeKeyToLabel[pto.pTOTypeKey]} PTO` : 'PTO'}
                        </Badge>
                      ))}
                      <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t border-border px-4 py-3 space-y-3">
                    <ScheduleFields
                      empId={emp.id}
                      empNum={emp.employeeCode}
                      dk={dayKey}
                      startTime={startTime}
                      onCall={onCall}
                      showApplyAll={showApplyAll}
                      onSave={handleSave}
                      onApplyAll={handleApplyAllDays}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRangeEmployeeId(emp.id);
                        setRangeViewRange(undefined);
                        setRangeOpenDay('');
                      }}
                    >
                      <CalendarRange className="mr-2 h-4 w-4" /> Date range
                    </Button>
                  </div>
                </CollapsibleContent>
              </section>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
