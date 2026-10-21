import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eachDayOfInterval, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon, Check, ChevronDown, Clock, Plus, X } from 'lucide-react';
import { toast } from '@/lib/toast';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import { EmployeeAccessGate } from '@/components/employee-access-gate';
import { EmployeeCodeSignIn, KioskSessionBar } from '@/components/kiosk-session';
import { useUser } from '@/hooks/use-user';
import { useKioskSession } from '@/hooks/use-kiosk-session';
import { VoiceNoteButton } from '@/components/voice-note-button';
import { useAllEquipmentAssets, useShopEmployeeList, useShopTimeEntryList, useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import { useEmployeeScheduledStarts } from '@/hooks/use-employee-scheduled-starts';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import {
  applyNoLunchMarker,
  dayHasNoLunch,
  formatDuration,
  getDayPayMinutes,
  getPtoHours,
  getRawDurationMinutes,
  isAwaitingAsset,
  isPtoEntry,
  keepAutoClockOutMarker,
  notesHaveNoLunch,
  waitBeforeFirstJob,
} from '@/lib/time-rules';
import {
  formatTimeForInput,
  dayClockCaption,
  getAssetDisplayName,
  getEmployeeNotes,
  getEntryAssetName,
  getEntryDivision,
  getEntryJobNumber,
  getEntryWorkDateKey,
  jobEntriesForDisplay,
  timeAfter,
  timeOnWorkDay,
} from '@/lib/entry-helpers';
import {
  ROAD_MECH_EDIT_DAYS,
  dayFirstClockIn,
  dayLastClockOut,
  isWithinRoadMechEditWindow,
  jobTimeLocks,
  planForgottenJobInsert,
} from '@/lib/day-session';
import { useRoadMechJobEdits } from '@/hooks/use-road-mech-job-edits';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { divisionLabel } from '@/lib/reference-data';
import { ShopTimeEntryPayTypeKeyToLabel, ShopTimeEntryPTOTypeKeyToLabel, type ShopTimeEntry } from '@/models/shop-time-entry';
import { isLinkedPersonalLogin, shouldShowEmployeeAccessGate, shouldShowEmployeeCodeSignIn } from '@/lib/app-access';

export default function MechanicLogPage() {
  const { data: user, isPending: userLoading } = useUser();
  const { employeeId: selectedEmployeeId } = useKioskSession();
  const linkedPersonalLogin = isLinkedPersonalLogin(user);
  const showAccessGate = shouldShowEmployeeAccessGate(user);
  const showCodeSignIn = shouldShowEmployeeCodeSignIn(user, userLoading, selectedEmployeeId);
  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfWeek(now, { weekStartsOn: 0 }),
    to: endOfWeek(now, { weekStartsOn: 0 }),
  });
  const [editingEntryId, setEditingEntryId] = useState('');
  const [editingAssetId, setEditingAssetId] = useState('');
  const [editingAssetRecord, setEditingAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(
    undefined,
  );
  const [editingDivision, setEditingDivision] = useState('');
  const [editingJobNumber, setEditingJobNumber] = useState('');
  const [editingStartedAt, setEditingStartedAt] = useState('');
  const [editingEndedAt, setEditingEndedAt] = useState('');
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
  const payProfile = useMemo(
    () => ({
      isRoadMech: selectedEmployee?.isRoadMech,
      isAdmin: selectedEmployee?.isAdmin,
      isPartsRunner: selectedEmployee?.isPartsRunner,
    }),
    [selectedEmployee?.isAdmin, selectedEmployee?.isPartsRunner, selectedEmployee?.isRoadMech],
  );
  const isRoadMech = selectedEmployee?.isRoadMech === true;
  // Each day pays from that day's scheduled start (or clock-in, if later).
  // Road mechanics and admins are paid from clock-in.
  const {
    payStartFor,
    failed: schedulesFailed,
    error: schedulesError,
    refetch: refetchSchedules,
  } = useEmployeeScheduledStarts(
    selectedEmployee?.id,
    selectedEmployee ? payProfile : undefined,
    dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : undefined,
    dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : undefined,
  );

  const canReshapeDay = (dateKey: string) => isRoadMech && isWithinRoadMechEditWindow(dateKey);
  const roadMechEdits = useRoadMechJobEdits(payStartFor, payProfile);

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

  const startEditTimecard = (entry: ShopTimeEntry) => {
    setEditingEntryId(entry.id);
    setEditingAssetId(entry.asset?.id ?? '');
    setEditingAssetRecord(entry.asset);
    setEditingDivision(getEntryDivision(entry, assets) ? String(getEntryDivision(entry, assets)) : '');
    setEditingJobNumber(getEntryJobNumber(entry));
    setEditingStartedAt(entry.clockIn ? formatTimeForInput(entry.clockIn) : '');
    setEditingEndedAt(entry.clockOut ? formatTimeForInput(entry.clockOut) : '');
    setEditingNotesEntryId('');
    setEditingNotes(getEmployeeNotes(entry.notes));
  };

  const cancelEditTimecard = () => {
    setEditingEntryId('');
    setEditingAssetId('');
    setEditingAssetRecord(undefined);
    setEditingDivision('');
    setEditingJobNumber('');
    setEditingStartedAt('');
    setEditingEndedAt('');
    setEditingNotes('');
  };

  const cancelJob = (entry: ShopTimeEntry, day: Date, dayEntries: ShopTimeEntry[]) =>
    roadMechEdits.cancelJob({
      entry,
      day,
      dayEntries,
      employeeName: selectedEmployee?.employeeName ?? entry.employee?.autoNumber ?? 'Employee',
      label: getEntryAssetName(entry, assets),
    });

  const saveTimecard = async (entry: ShopTimeEntry, day: Date, dayEntries: ShopTimeEntry[]) => {
    const when = format(day, 'MMM d');
    const newAsset = editingAssetId
      ? (editingAssetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === editingAssetId))
      : undefined;
    const manualDivision = editingDivision.trim();
    const manualJobNumber = editingJobNumber.trim();
    if (manualDivision && !Number.isFinite(Number(manualDivision))) {
      toast.error('Division must be a number.');
      return;
    }
    const assetLabel = newAsset ? getAssetDisplayName(newAsset) : getEntryAssetName(entry, assets);
    const entryLabel =
      [assetLabel, manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ') ||
      (manualDivision ? `Division ${manualDivision}` : 'Time entry');
    const employeeName = selectedEmployee?.employeeName ?? entry.employee?.autoNumber ?? 'Employee';
    const nextNotes = keepAutoClockOutMarker(
      entry.notes,
      applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || dayHasNoLunch(dayEntries)),
    );
    const staysUnassigned = isAwaitingAsset(entry) && !newAsset && !manualDivision && !manualJobNumber;
    const details = {
      timeEntry: staysUnassigned ? entry.timeEntry : `${employeeName} - ${entryLabel}`,
      asset: newAsset ? { id: newAsset.id, asset: getAssetDisplayName(newAsset) } : entry.asset,
      assetDivision: newAsset ? newAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
      division: newAsset ? newAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
      jobNumber: manualJobNumber || undefined,
      notes: nextNotes,
    };

    if (canReshapeDay(format(day, 'yyyy-MM-dd')) && roadMechEdits.timesChanged(entry, editingStartedAt, editingEndedAt)) {
      const label = staysUnassigned ? 'Unassigned time' : assetLabel;
      const saved = await roadMechEdits.saveJobTimes({
        entry,
        day,
        dayEntries,
        startValue: editingStartedAt,
        endValue: editingEndedAt,
        details,
        label,
      });
      if (saved) cancelEditTimecard();
      return;
    }

    try {
      await updateTimeEntry.mutateAsync({ id: entry.id, changedFields: details });
      cancelEditTimecard();
      toast.success(`Timecard updated for ${when} — ${assetLabel}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update timecard.');
    }
  };

  const startEditNotes = (entry: ShopTimeEntry) => {
    cancelEditTimecard();
    setEditingNotesEntryId(entry.id);
    setEditingNotes(getEmployeeNotes(entry.notes));
  };

  const handleAcceptedCode = () => {
    cancelEditTimecard();
    setEditingNotesEntryId('');
    setEditingNotes('');
    resetJobForm();
  };

  const cancelEditNotes = (entry?: ShopTimeEntry) => {
    if (entry) setEditingNotes(getEmployeeNotes(entry.notes));
    setEditingNotesEntryId('');
    setEditingNotes('');
  };

  const saveNotes = (entry: ShopTimeEntry, day: Date, dayEntries: ShopTimeEntry[]) => {
    const when = format(day, 'MMM d');
    const assetName = getEntryAssetName(entry, assets);
    const nextNotes = keepAutoClockOutMarker(
      entry.notes,
      applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || dayHasNoLunch(dayEntries)),
    );
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
    const startedAt = timeOnWorkDay(day, jobStartedAt, dayEntries);
    const endedAt = timeAfter(startedAt, jobEndedAt);
    const plan = planForgottenJobInsert(dayEntries, startedAt, endedAt, payStartFor(format(day, 'yyyy-MM-dd')), payProfile);
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
      // Creates go first so the new job covers the window before neighbors shrink; a road mechanic's write may never open a gap in the punched day.
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
    const fromKey = format(dateRange.from, 'yyyy-MM-dd');
    const toKey = format(dateRange.to, 'yyyy-MM-dd');
    return timeEntries
      .filter((entry: ShopTimeEntry) => {
        if (entry.employee?.id !== selectedEmployee.id) return false;
        if (!entry.clockIn) return false;
        const workDay = getEntryWorkDateKey(entry);
        return workDay >= fromKey && workDay <= toKey;
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
      const entries = filteredEntries.filter((entry: ShopTimeEntry) => getEntryWorkDateKey(entry) === dateKey);
      const dayPayStart = payStartFor(dateKey);
      const totalHours = getDayPayMinutes(entries, new Date(), dayPayStart, payProfile).totalMinutes / 60;
      // Road mechanics also see unassigned time so they can assign it or stretch a neighbor over it.
      const rows = isRoadMech
        ? entries.filter((entry) => !isAwaitingAsset(entry) || (entry.clockOut && getRawDurationMinutes(entry) >= 5))
        : jobEntriesForDisplay(entries);
      return {
        day,
        dateKey,
        entries,
        jobs: jobEntriesForDisplay(entries),
        rows,
        locksById: new Map(isRoadMech ? rows.map((entry) => [entry.id, jobTimeLocks(entries, entry)] as const) : []),
        clockLabel: dayClockCaption(entries),
        waitBeforeJob: waitBeforeFirstJob(entries, new Date(), dayPayStart, payProfile),
        totalHours,
        firstIn: dayFirstClockIn(entries),
        lastOut: dayLastClockOut(entries),
      };
    });
  }, [days, filteredEntries, isRoadMech, payProfile, payStartFor]);

  const rangeTotalHours = useMemo(() => Math.round(dayData.reduce((sum, d) => sum + d.totalHours, 0) * 100) / 100, [dayData]);

  const assetSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dayData) {
      for (const entry of d.jobs) {
        const name = getEntryAssetName(entry, assets);
        map.set(name, (map.get(name) ?? 0) + getRawDurationMinutes(entry) / 60);
      }
    }
    return [...map.entries()].map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total);
  }, [dayData, assets]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {userLoading ? <p className="text-sm text-muted-foreground">Loading your account…</p> : null}
      {showAccessGate && user ? <EmployeeAccessGate email={user.email} /> : null}
      {showCodeSignIn ? (
        <EmployeeCodeSignIn
          id="mechanic-code"
          employees={employees}
          loading={employeesLoading}
          failed={employeesFailed}
          error={employeesError}
          onRetry={() => void refetchEmployees()}
          submitLabel="View my work log"
          onAccepted={handleAcceptedCode}
        />
      ) : null}
      {!userLoading && !selectedEmployee && linkedPersonalLogin ? (
        <p className="text-sm text-muted-foreground">Loading your work log…</p>
      ) : null}
      {selectedEmployee ? (
        <section className="grid gap-6">
          <KioskSessionBar
            employee={selectedEmployee}
            detail="Mechanic Log"
            onLeave={handleAcceptedCode}
            showEmployeeSignOut={user?.requiresEmployeeCode ?? true}
          />

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

          {schedulesFailed ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Could not load scheduled starts.</p>
              <p className="mt-1 break-words text-destructive/80">
                {schedulesError instanceof Error ? schedulesError.message : 'Schedule list failed to load.'} Hours below assume a 7:00 AM
                start until this succeeds, so they may not match the manager dashboard.
              </p>
              <Button type="button" variant="outline" className="mt-3" onClick={() => void refetchSchedules()}>
                Retry
              </Button>
            </div>
          ) : null}

          {/* Date range and total hours */}
          <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from
                      ? dateRange.to
                        ? `${format(dateRange.from, 'MMM d')} – ${format(dateRange.to, 'MMM d, yyyy')}`
                        : format(dateRange.from, 'MMM d, yyyy')
                      : 'Pick a date range'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} initialFocus />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setQuickRange(startOfWeek(now, { weekStartsOn: 0 }), endOfWeek(now, { weekStartsOn: 0 }))}
              >
                This Week
              </Button>
              <Button
                type="button"
                variant="ghost"
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
                variant="ghost"
                size="sm"
                onClick={() => {
                  const twoWeeksAgo = subWeeks(now, 2);
                  setQuickRange(startOfWeek(twoWeeksAgo, { weekStartsOn: 0 }), endOfWeek(subWeeks(now, 1), { weekStartsOn: 0 }));
                }}
              >
                Last 2 Weeks
              </Button>
              <p className="ml-auto text-sm text-muted-foreground">
                Total <span className="text-lg font-bold text-foreground tabular-nums">{rangeTotalHours.toFixed(1)}</span> h
              </p>
            </CardContent>
          </Card>

          {/* Daily breakdowns */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Daily Breakdown</h2>
            {dayData.filter((d) => isRoadMech || d.entries.length > 0).length === 0 ? (
              <Card className="bg-card text-card-foreground shadow-sm">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No time entries found for this date range.
                </CardContent>
              </Card>
            ) : (
              dayData
                .filter((d) => isRoadMech || d.entries.length > 0)
                .map((d) =>
                  d.entries.length === 0 ? (
                    <Card key={d.dateKey} className="bg-muted text-muted-foreground shadow-sm" aria-disabled="true">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-4">
                          <CardTitle className="text-base">{format(d.day, 'EEEE, MMM d')}</CardTitle>
                          <span className="text-sm font-semibold tracking-wide">NO CLOCK IN</span>
                        </div>
                      </CardHeader>
                    </Card>
                  ) : (
                    <Collapsible key={d.dateKey}>
                      <Card className="bg-card text-card-foreground shadow-sm">
                        <CollapsibleTrigger className="w-full text-left">
                          <CardHeader className="cursor-pointer">
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <CardTitle className="text-base">{format(d.day, 'EEEE, MMM d')}</CardTitle>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                  {d.jobs.length} {d.jobs.length === 1 ? 'entry' : 'entries'}
                                  {d.clockLabel ? ` · ${d.clockLabel}` : ''}
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
                            {isRoadMech && d.firstIn && !canReshapeDay(d.dateKey) ? (
                              <p className="text-sm text-muted-foreground">
                                Job times can be changed for the last {ROAD_MECH_EDIT_DAYS} days. Ask a manager to change an older day.
                              </p>
                            ) : d.lastOut ? (
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
                            {d.rows.map((entry: ShopTimeEntry) => {
                              const paidMinutes = getRawDurationMinutes(entry);
                              const unassigned = isAwaitingAsset(entry);
                              const assetName = unassigned ? 'Unassigned time' : getEntryAssetName(entry, assets);
                              const jobNum = getEntryJobNumber(entry);
                              const effectiveDivision = getEntryDivision(entry, assets);
                              const div = effectiveDivision ? divisionLabel(Number(effectiveDivision)) : '';
                              const notes = getEmployeeNotes(entry.notes);
                              const editingTimecard = editingEntryId === entry.id;
                              const editingNotesOnly = editingNotesEntryId === entry.id;
                              const reshape = canReshapeDay(d.dateKey) && !isPtoEntry(entry);
                              const locks = reshape ? d.locksById.get(entry.id) : undefined;
                              const busy = updateTimeEntry.isPending || jobSaving || roadMechEdits.saving;
                              const timeKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                  void saveTimecard(entry, d.day, d.entries);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelEditTimecard();
                                }
                              };
                              return (
                                <div
                                  key={entry.id}
                                  className={`rounded-lg border p-3 ${unassigned ? 'border-dashed border-border bg-muted' : 'border-border bg-background'}`}
                                >
                                  {editingTimecard && !isPtoEntry(entry) ? (
                                    <div className="space-y-3">
                                      {locks ? (
                                        <div className="space-y-2">
                                          <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-2">
                                              <Label htmlFor={`edit-start-${entry.id}`}>Started</Label>
                                              <Input
                                                id={`edit-start-${entry.id}`}
                                                type="time"
                                                className="bg-background"
                                                value={editingStartedAt}
                                                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                                  setEditingStartedAt(event.target.value)
                                                }
                                                onKeyDown={timeKeys}
                                                disabled={locks.startLocked || busy}
                                              />
                                              {locks.startLocked ? (
                                                <p className="text-xs text-muted-foreground">This is your clock-in, so it can't move.</p>
                                              ) : null}
                                            </div>
                                            <div className="space-y-2">
                                              <Label htmlFor={`edit-end-${entry.id}`}>Ended</Label>
                                              <Input
                                                id={`edit-end-${entry.id}`}
                                                type="time"
                                                className="bg-background"
                                                value={editingEndedAt}
                                                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                                  setEditingEndedAt(event.target.value)
                                                }
                                                onKeyDown={timeKeys}
                                                disabled={locks.endLocked || busy}
                                              />
                                              {!entry.clockOut ? (
                                                <p className="text-xs text-muted-foreground">
                                                  Still running. It ends when you switch jobs or clock out.
                                                </p>
                                              ) : locks.endLocked ? (
                                                <p className="text-xs text-muted-foreground">This is your clock-out, so it can't move.</p>
                                              ) : null}
                                            </div>
                                          </div>
                                          <p className="text-sm text-muted-foreground">
                                            The job next to this one gives up or takes the difference. Your clock-in and clock-out stay the
                                            same.
                                          </p>
                                        </div>
                                      ) : null}
                                      <div className="space-y-2">
                                        <Label>Equipment asset</Label>
                                        <AssetPicker
                                          assets={assets}
                                          value={editingAssetId}
                                          onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => {
                                            setEditingAssetRecord(asset);
                                            setEditingAssetId(asset?.id ?? '');
                                            if (asset?.divisionCode !== undefined) {
                                              setEditingDivision(String(asset.divisionCode));
                                            }
                                          }}
                                          currentAsset={editingAssetRecord ?? entry.asset}
                                        />
                                      </div>
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-division-${entry.id}`}>Division</Label>
                                          <Input
                                            id={`edit-division-${entry.id}`}
                                            className="bg-background"
                                            value={editingDivision}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditingDivision(event.target.value.replace(/\D/g, ''))
                                            }
                                            placeholder="Optional division code"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-job-${entry.id}`}>Job number</Label>
                                          <Input
                                            id={`edit-job-${entry.id}`}
                                            className="bg-background"
                                            value={editingJobNumber}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditingJobNumber(event.target.value)
                                            }
                                            placeholder="Optional job number"
                                          />
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <Label htmlFor={`edit-notes-${entry.id}`}>Notes</Label>
                                          <VoiceNoteButton
                                            value={editingNotes}
                                            onChange={setEditingNotes}
                                            phrases={voicePhrases}
                                            disabled={updateTimeEntry.isPending}
                                          />
                                        </div>
                                        <Textarea
                                          id={`edit-notes-${entry.id}`}
                                          className="bg-background"
                                          value={editingNotes}
                                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)}
                                          placeholder="Optional job notes"
                                          disabled={updateTimeEntry.isPending}
                                        />
                                      </div>
                                      <div className="flex flex-wrap items-center justify-end gap-2">
                                        <Button
                                          type="button"
                                          size="icon"
                                          aria-label="Save timecard"
                                          onClick={() => void saveTimecard(entry, d.day, d.entries)}
                                          disabled={updateTimeEntry.isPending}
                                        >
                                          <Check className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="outline"
                                          aria-label="Cancel timecard edit"
                                          onClick={cancelEditTimecard}
                                          disabled={updateTimeEntry.isPending}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
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
                                      {unassigned ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                          No job on this time. Assign one, or change the times on the job before or after it.
                                        </p>
                                      ) : null}
                                      {!isPtoEntry(entry) ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => startEditTimecard(entry)}
                                            disabled={busy}
                                          >
                                            {unassigned ? 'Assign job' : 'Edit timecard'}
                                          </Button>
                                          {reshape && !unassigned && entry.clockIn && entry.clockOut ? (
                                            <AlertDialog>
                                              <AlertDialogTrigger asChild>
                                                <Button type="button" variant="outline" size="sm" disabled={busy}>
                                                  Cancel job
                                                </Button>
                                              </AlertDialogTrigger>
                                              <AlertDialogContent>
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle>Cancel {assetName}?</AlertDialogTitle>
                                                  <AlertDialogDescription>
                                                    {format(new Date(entry.clockIn), 'p')} – {format(new Date(entry.clockOut), 'p')} on{' '}
                                                    {format(d.day, 'MMM d')} becomes unassigned time. Your hours for the day stay the same,
                                                    and the jobs around it keep their times until you change them.
                                                  </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                  <AlertDialogCancel>Keep job</AlertDialogCancel>
                                                  <AlertDialogAction onClick={() => void cancelJob(entry, d.day, d.entries)}>
                                                    Cancel job
                                                  </AlertDialogAction>
                                                </AlertDialogFooter>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                  {editingNotesOnly ? (
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
                                  ) : !editingTimecard ? (
                                    <div className="mt-3 space-y-2">
                                      {notes ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{notes}</p> : null}
                                      <Button type="button" variant="outline" size="sm" onClick={() => startEditNotes(entry)}>
                                        {notes ? 'Edit notes' : 'Add notes'}
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  ),
                )
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
      ) : null}
    </main>
  );
}
