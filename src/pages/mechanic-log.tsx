import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eachDayOfInterval, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon, Check, ChevronDown, Clock, Plus, Search, X } from 'lucide-react';
import { toast } from '@/lib/toast';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { AssetPicker } from '@/components/asset-picker';
import { VoiceNoteButton } from '@/components/voice-note-button';
import { useAllEquipmentAssets, useShopEmployeeList, useShopTimeEntryList, useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import {
  applyNoLunchMarker,
  dayHasNoLunch,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  getRawDurationMinutes,
  isPtoEntry,
  notesHaveNoLunch,
  scheduledStartFor,
} from '@/lib/time-rules';
import {
  EMPLOYEE_CODE_NOT_FOUND,
  combineSelectedDateAndTime,
  findEmployeeByCode,
  formatTimeForInput,
  getAssetDisplayName,
  getEmployeeNotes,
  getEntryAssetName,
  getEntryDivision,
  getEntryJobNumber,
} from '@/lib/entry-helpers';
import { dayFirstClockIn, dayLastClockOut, planForgottenJobInsert } from '@/lib/day-session';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { divisionLabel } from '@/lib/reference-data';
import { ShopTimeEntryPayTypeKeyToLabel, ShopTimeEntryPTOTypeKeyToLabel, type ShopTimeEntry } from '@/models/shop-time-entry';

export default function MechanicLogPage() {
  const [employeeCode, setEmployeeCode] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfWeek(now, { weekStartsOn: 0 }),
    to: endOfWeek(now, { weekStartsOn: 0 }),
  });
  const [editingNotesEntryId, setEditingNotesEntryId] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [addingJobDateKey, setAddingJobDateKey] = useState('');
  const [jobAssetId, setJobAssetId] = useState('');
  const [jobAssetRecord, setJobAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(undefined);
  const [jobDivision, setJobDivision] = useState('');
  const [jobNumber, setJobNumber] = useState('');
  const [jobNotes, setJobNotes] = useState('');
  const [jobStartedAt, setJobStartedAt] = useState('');
  const [jobEndedAt, setJobEndedAt] = useState('');
  const [jobSaving, setJobSaving] = useState(false);

  const queryClient = useQueryClient();
  const {
    data: shopEmployees = [],
    isLoading: employeesLoading,
    isError: employeesFailed,
    error: employeesError,
    refetch: refetchEmployees,
  } = useShopEmployeeList();
  const employees = useMemo(() => mapShopEmployees(shopEmployees), [shopEmployees]);
  const { data: assets = [] } = useAllEquipmentAssets();
  const { data: timeEntries = [], isError: entriesFailed, error: entriesError, refetch: refetchEntries } = useShopTimeEntryList();
  const updateTimeEntry = useUpdateShopTimeEntry();

  const selectedEmployee = employees.find((e: AppShopEmployee) => e.id === selectedEmployeeId);
  // Road mechanics are paid from their actual clock-in rather than a default start.
  const payStart = scheduledStartFor(selectedEmployee);

  const handleEmployeeCodeSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const matched = findEmployeeByCode(employees, employeeCode);
    if (!matched) {
      setSelectedEmployeeId('');
      toast.error(EMPLOYEE_CODE_NOT_FOUND);
      return;
    }
    setSelectedEmployeeId(matched.id);
    toast.success(`Verified ${matched.employeeName}.`);
  };

  const resetJobForm = () => {
    setAddingJobDateKey('');
    setJobAssetId('');
    setJobAssetRecord(undefined);
    setJobDivision('');
    setJobNumber('');
    setJobNotes('');
    setJobStartedAt('');
    setJobEndedAt('');
  };

  const handleResetEmployee = () => {
    setEmployeeCode('');
    setSelectedEmployeeId('');
    setEditingNotesEntryId('');
    setEditingNotes('');
    resetJobForm();
  };

  const voicePhrases = useMemo(
    () =>
      [
        ...assets.map((asset) => asset.asset).filter(Boolean),
        selectedEmployee?.employeeName,
        'job',
        'division',
        'handoff',
        'parts',
        'waiting on parts',
      ].filter((value): value is string => Boolean(value)),
    [assets, selectedEmployee?.employeeName],
  );

  const startEditNotes = (entry: ShopTimeEntry) => {
    setEditingNotesEntryId(entry.id);
    setEditingNotes(getEmployeeNotes(entry.notes));
  };

  const cancelEditNotes = (entry?: ShopTimeEntry) => {
    if (entry) setEditingNotes(getEmployeeNotes(entry.notes));
    setEditingNotesEntryId('');
    setEditingNotes('');
  };

  const saveNotes = (entry: ShopTimeEntry, day: Date, dayEntries: ShopTimeEntry[]) => {
    const when = format(day, 'MMM d');
    const assetName = getEntryAssetName(entry, assets);
    const nextNotes = applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || dayHasNoLunch(dayEntries));
    void queryClient.cancelQueries({ queryKey: queryKeys.timeEntries() });
    const previous = queryClient.getQueryData<ShopTimeEntry[]>(queryKeys.timeEntries());
    queryClient.setQueryData<ShopTimeEntry[]>(queryKeys.timeEntries(), (rows) =>
      rows?.map((row) => (row.id === entry.id ? { ...row, notes: nextNotes || undefined } : row)),
    );
    updateTimeEntry.mutate(
      { id: entry.id, changedFields: { notes: nextNotes } },
      {
        onSuccess: () => {
          setEditingNotesEntryId('');
          setEditingNotes('');
          toast.success(`Notes saved for ${when} — ${assetName}.`);
        },
        onError: (error) => {
          if (previous) queryClient.setQueryData(queryKeys.timeEntries(), previous);
          toast.error(error instanceof Error ? error.message : 'Unable to save notes.');
        },
      },
    );
  };

  const addForgottenJob = async (day: Date, dayEntries: ShopTimeEntry[]) => {
    if (!selectedEmployee) {
      toast.error('Verify your employee code before adding a job.');
      return;
    }
    const selectedAssetForEntry = jobAssetId ? (jobAssetRecord ?? assets.find((asset) => asset.id === jobAssetId)) : undefined;
    const manualDivision = jobDivision.trim();
    const manualJobNumber = jobNumber.trim();
    if (!selectedAssetForEntry && !manualDivision && !manualJobNumber) {
      toast.error('An asset, division, or job number is required.');
      return;
    }
    const divisionNumber = manualDivision ? Number(manualDivision) : selectedAssetForEntry?.divisionCode;
    if (manualDivision && !Number.isFinite(divisionNumber)) {
      toast.error('Division must be a number.');
      return;
    }
    if (!jobStartedAt || !jobEndedAt) {
      toast.error('Enter the start and end time for this job.');
      return;
    }
    const startedAt = combineSelectedDateAndTime(day, jobStartedAt);
    const endedAt = combineSelectedDateAndTime(day, jobEndedAt);
    const plan = planForgottenJobInsert(dayEntries, startedAt, endedAt, payStart);
    if ('error' in plan) {
      toast.error(plan.error);
      return;
    }
    const selectedAssetName = selectedAssetForEntry ? getAssetDisplayName(selectedAssetForEntry) : '';
    const fallbackLabel = [manualDivision ? `Division ${manualDivision}` : '', manualJobNumber ? `Job ${manualJobNumber}` : '']
      .filter((value: string) => value)
      .join(' · ');
    const entryLabel = selectedAssetName
      ? [selectedAssetName, manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ')
      : fallbackLabel || 'Time entry';
    const when = format(day, 'MMM d');
    const notes = applyNoLunchMarker(jobNotes.trim() || undefined, dayHasNoLunch(dayEntries));
    const newRow: ShopTimeEntry = {
      id: `optimistic-job-${startedAt}`,
      timeEntry: `${selectedEmployee.employeeName} - ${entryLabel}`,
      employee: { id: selectedEmployee.id, autoNumber: selectedEmployee.autoNumber },
      asset: selectedAssetForEntry ? { id: selectedAssetForEntry.id, asset: selectedAssetName } : undefined,
      assetDivision: divisionNumber,
      division: divisionNumber,
      jobNumber: manualJobNumber || undefined,
      clockIn: startedAt,
      clockOut: endedAt,
      hours: plan.creates.find((row) => row.kind === 'new')?.hours,
      workDate: format(day, 'yyyy-MM-dd'),
      notes,
    };
    const remainderRows = plan.creates
      .filter((row) => row.kind === 'remainder' && row.copyFrom)
      .map((row) => ({
        ...row.copyFrom!,
        id: `optimistic-remainder-${row.clockIn}`,
        clockIn: row.clockIn,
        clockOut: row.clockOut,
        hours: row.hours,
      }));
    await queryClient.cancelQueries({ queryKey: queryKeys.timeEntries() });
    const previous = queryClient.getQueryData<ShopTimeEntry[]>(queryKeys.timeEntries());
    queryClient.setQueryData<ShopTimeEntry[]>(queryKeys.timeEntries(), (rows) => {
      const next = (rows ?? []).map((row) => {
        const patch = plan.patches.find((item) => item.id === row.id);
        if (!patch) return row;
        return {
          ...row,
          clockIn: patch.clockIn ?? row.clockIn,
          clockOut: patch.clockOut ?? row.clockOut,
          hours: patch.hours,
        };
      });
      return [...next, newRow, ...remainderRows];
    });
    resetJobForm();
    setJobSaving(true);
    try {
      for (const patch of plan.patches) {
        await apiFetch(`/api/time-entries/${patch.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            clockIn: patch.clockIn,
            clockOut: patch.clockOut,
            hours: patch.hours,
          }),
        });
      }
      for (const created of plan.creates) {
        const source = created.kind === 'remainder' && created.copyFrom ? created.copyFrom : newRow;
        await apiFetch<ShopTimeEntry>('/api/time-entries', {
          method: 'POST',
          body: JSON.stringify({
            timeEntry: created.kind === 'new' ? newRow.timeEntry : source.timeEntry,
            employee: source.employee,
            asset: created.kind === 'new' ? newRow.asset : source.asset,
            assetDivision: created.kind === 'new' ? newRow.assetDivision : source.assetDivision,
            division: created.kind === 'new' ? newRow.division : source.division,
            jobNumber: created.kind === 'new' ? newRow.jobNumber : source.jobNumber,
            clockIn: created.clockIn,
            clockOut: created.clockOut,
            hours: created.hours,
            workDate: format(day, 'yyyy-MM-dd'),
            notes: created.kind === 'new' ? notes : source.notes,
          }),
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.timeEntries() });
      toast.success(
        `Added ${entryLabel} for ${when} from ${format(new Date(startedAt), 'p')} to ${format(new Date(endedAt), 'p')}. Nearby jobs were shortened. Day stays ${format(new Date(plan.firstIn), 'p')} – ${format(new Date(plan.lastOut), 'p')}.`,
      );
    } catch (error: unknown) {
      if (previous) queryClient.setQueryData(queryKeys.timeEntries(), previous);
      toast.error(error instanceof Error ? error.message : 'Unable to add the job.');
    } finally {
      setJobSaving(false);
    }
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
      const entries = filteredEntries.filter((entry: ShopTimeEntry) => entry.clockIn?.startsWith(dateKey));
      const totalHours = getDayPayMinutes(entries, new Date(), payStart).totalMinutes / 60;
      return {
        day,
        dateKey,
        entries,
        totalHours,
        firstIn: dayFirstClockIn(entries),
        lastOut: dayLastClockOut(entries),
      };
    });
  }, [days, filteredEntries, payStart]);

  const rangeTotalHours = useMemo(() => Math.round(dayData.reduce((sum, d) => sum + d.totalHours, 0) * 100) / 100, [dayData]);

  const assetSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dayData) {
      for (const entry of d.entries) {
        const name = getEntryAssetName(entry, assets);
        map.set(name, (map.get(name) ?? 0) + getEntryPaidMinutes(d.entries, entry, new Date(), payStart) / 60);
      }
    }
    return [...map.entries()].map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total);
  }, [dayData, assets, payStart]);

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
                  <Button type="button" variant="outline" className="mt-3" onClick={() => void refetchEmployees()}>
                    Retry
                  </Button>
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
                  <p className="mt-1 text-sm text-muted-foreground">Employee {selectedEmployee.employeeCode} · Mechanic Log</p>
                </div>
                <Button type="button" variant="outline" onClick={handleResetEmployee}>
                  Change employee
                </Button>
              </div>
            </CardHeader>
          </Card>

          {entriesFailed ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Could not load time entries from Dataverse.</p>
              <p className="mt-1 break-words text-destructive/80">
                {entriesError instanceof Error ? entriesError.message : 'Grant the app user Read on Shop Time Entry, then retry.'}
              </p>
              <Button type="button" variant="outline" className="mt-3" onClick={() => void refetchEntries()}>
                Retry
              </Button>
            </div>
          ) : null}

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
                    {dateRange?.from
                      ? dateRange.to
                        ? `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}`
                        : format(dateRange.from, 'MMM d, yyyy')
                      : 'Pick a date range'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} initialFocus />
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          {/* Weekly summary */}
          <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
            <CardContent className="p-4">
              <div className="rounded-md bg-muted px-3 py-3 text-center">
                <p className="text-xs text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold text-foreground">{rangeTotalHours.toFixed(1)}</p>
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
                                {d.firstIn
                                  ? ` · ${format(new Date(d.firstIn), 'p')}${d.lastOut ? ` – ${format(new Date(d.lastOut), 'p')}` : ' · still clocked in'}`
                                  : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-semibold">{d.totalHours.toFixed(1)}h</span>
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]>*>&]:rotate-180" />
                            </div>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="space-y-2 border-t border-border pt-4">
                          {d.lastOut ? (
                            <div className="space-y-3">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  resetJobForm();
                                  setAddingJobDateKey(d.dateKey);
                                  setJobEndedAt(formatTimeForInput(d.lastOut));
                                }}
                              >
                                <Plus className="mr-2 h-4 w-4" /> Add Job
                              </Button>
                              {addingJobDateKey === d.dateKey ? (
                                <div className="grid gap-3 rounded-lg border border-dashed border-border bg-muted p-3 text-muted-foreground">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="font-medium text-foreground">Add forgotten job</p>
                                    <Button type="button" size="icon" variant="ghost" aria-label="Cancel new job" onClick={resetJobForm}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Equipment asset</Label>
                                    <AssetPicker
                                      assets={assets}
                                      value={jobAssetId}
                                      onChange={(asset) => {
                                        setJobAssetRecord(asset);
                                        setJobAssetId(asset?.id ?? '');
                                        setJobDivision(asset?.divisionCode === undefined ? '' : String(asset.divisionCode));
                                      }}
                                      currentAsset={jobAssetRecord}
                                    />
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label htmlFor={`job-started-${d.dateKey}`}>Started</Label>
                                      <Input
                                        id={`job-started-${d.dateKey}`}
                                        type="time"
                                        className="bg-background"
                                        value={jobStartedAt}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobStartedAt(event.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor={`job-ended-${d.dateKey}`}>Ended</Label>
                                      <Input
                                        id={`job-ended-${d.dateKey}`}
                                        type="time"
                                        className="bg-background"
                                        value={jobEndedAt}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobEndedAt(event.target.value)}
                                      />
                                    </div>
                                  </div>
                                  <p className="text-sm">
                                    Jobs before this start and after this end shorten immediately. Day stays{' '}
                                    {format(new Date(d.firstIn ?? d.lastOut), 'p')} – {format(new Date(d.lastOut), 'p')}.
                                  </p>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label htmlFor={`job-div-${d.dateKey}`}>Division (optional)</Label>
                                      <Input
                                        id={`job-div-${d.dateKey}`}
                                        className="bg-background"
                                        value={jobDivision}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobDivision(event.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor={`job-num-${d.dateKey}`}>Job number (optional)</Label>
                                      <Input
                                        id={`job-num-${d.dateKey}`}
                                        className="bg-background"
                                        value={jobNumber}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobNumber(event.target.value)}
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <Label htmlFor={`job-notes-${d.dateKey}`}>Notes</Label>
                                      <VoiceNoteButton
                                        value={jobNotes}
                                        onChange={setJobNotes}
                                        phrases={voicePhrases}
                                        disabled={jobSaving || updateTimeEntry.isPending}
                                      />
                                    </div>
                                    <Textarea
                                      id={`job-notes-${d.dateKey}`}
                                      className="bg-background"
                                      value={jobNotes}
                                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setJobNotes(event.target.value)}
                                      placeholder="Optional job notes"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    onClick={() => void addForgottenJob(d.day, d.entries)}
                                    disabled={jobSaving || updateTimeEntry.isPending}
                                  >
                                    Add job
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ) : d.firstIn ? (
                            <p className="text-sm text-muted-foreground">Clock out on the timecard before adding a forgotten job.</p>
                          ) : null}
                          {d.entries.map((entry: ShopTimeEntry) => {
                            const paidMinutes = getRawDurationMinutes(entry);
                            const assetName = getEntryAssetName(entry, assets);
                            const jobNum = getEntryJobNumber(entry);
                            const effectiveDivision = getEntryDivision(entry, assets);
                            const div = effectiveDivision ? divisionLabel(Number(effectiveDivision)) : '';
                            const notes = getEmployeeNotes(entry.notes);
                            const editing = editingNotesEntryId === entry.id;
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
                                      <Badge variant="outline">{ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey]}</Badge>
                                    )}
                                    {isPtoEntry(entry) && <Badge variant="secondary">PTO {getPtoHours(entry)}h</Badge>}
                                    {entry.pTOTypeKey && entry.pTOTypeKey in ShopTimeEntryPTOTypeKeyToLabel && (
                                      <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge>
                                    )}
                                    {entry.onCall && <Badge variant="secondary">On Call</Badge>}
                                  </div>
                                </div>
                                {editing ? (
                                  <div className="mt-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <Label htmlFor={`log-notes-${entry.id}`}>Notes</Label>
                                      <VoiceNoteButton
                                        value={editingNotes}
                                        onChange={setEditingNotes}
                                        phrases={voicePhrases}
                                        disabled={updateTimeEntry.isPending}
                                      />
                                    </div>
                                    <Textarea
                                      id={`log-notes-${entry.id}`}
                                      value={editingNotes}
                                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)}
                                      onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          cancelEditNotes(entry);
                                        }
                                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                          event.preventDefault();
                                          saveNotes(entry, d.day, d.entries);
                                        }
                                      }}
                                      placeholder="Add notes for this time entry"
                                      disabled={updateTimeEntry.isPending}
                                    />
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      <Button
                                        type="button"
                                        size="icon"
                                        aria-label="Save notes"
                                        onClick={() => saveNotes(entry, d.day, d.entries)}
                                        disabled={updateTimeEntry.isPending}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        aria-label="Cancel notes edit"
                                        onClick={() => cancelEditNotes(entry)}
                                        disabled={updateTimeEntry.isPending}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {notes ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{notes}</p> : null}
                                    <Button type="button" variant="outline" size="sm" onClick={() => startEditNotes(entry)}>
                                      {notes ? 'Edit notes' : 'Add notes'}
                                    </Button>
                                  </div>
                                )}
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
                        <th className="pb-2 pl-4 text-right font-medium">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetSummary.map((row) => (
                        <tr key={row.name} className="border-b border-border last:border-0">
                          <td className="py-2 pr-4 font-medium text-foreground">{row.name}</td>
                          <td className="py-2 pl-4 text-right tabular-nums">{row.total.toFixed(1)}</td>
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
