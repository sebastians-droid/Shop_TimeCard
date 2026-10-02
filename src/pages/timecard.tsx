import { useMemo, useState } from 'react';
import { addHours, format, startOfDay } from 'date-fns';
import { CalendarIcon, Check, Plus, RefreshCw, TimerReset, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { VoiceNoteButton } from '@/components/voice-note-button';
import { AssetPicker } from '@/components/asset-picker';
import { EmployeeCodeSignIn, KioskSessionBar } from '@/components/kiosk-session';
import { useKioskSession } from '@/hooks/use-kiosk-session';
import {
  useAllEquipmentAssets,
  useCreateShopTimeEntry,
  useShopEmployeeList,
  useShopTimeEntryList,
  useUpdateShopTimeEntry,
} from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import {
  applyNoLunchMarker,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  getRawDurationMinutes,
  AWAITING_ASSET_LABEL,
  isAwaitingAsset,
  isPtoEntry,
  scheduledStartFor,
  notesHaveNoLunch,
  stripNoLunchMarker,
} from '@/lib/time-rules';
import {
  getAssetDisplayName,
  getEntryAssetName,
  getEntryDivision,
  getEntryJobNumber,
  PTO_TIME_KEY_BY_HOURS,
  getPtoClockInIso,
  type PtoHours,
} from '@/lib/entry-helpers';
import { dayFirstClockIn, dayLastClockOut } from '@/lib/day-session';
import { useReloadTables } from '@/hooks/use-reload-tables';
import { ShopTimeEntryPTOTypeKeyToLabel, type ShopTimeEntry, type ShopTimeEntryPTOTypeKey } from '@/models/shop-time-entry';
import { getCurrentPosition } from '@/lib/geolocation';
type ClockInConfirmation = {
  employeeName: string;
  asset: string;
  division: string;
  jobNumber: string;
  clockIn: string;
};

const getNowIso = () => new Date().toISOString();
const getWorkDate = (dateTime: string) => format(new Date(dateTime), 'yyyy-MM-dd');

export default function TimecardPage() {
  const { employeeId: selectedEmployeeId } = useKioskSession();
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [selectedAssetRecord, setSelectedAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(
    undefined,
  );
  const [division, setDivision] = useState<string>('');
  const [jobNumber, setJobNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [assetFormMode, setAssetFormMode] = useState<'start-asset' | null>(null);
  const [showPtoForm, setShowPtoForm] = useState<boolean>(false);
  const [ptoDate, setPtoDate] = useState<Date | undefined>(startOfDay(new Date()));
  const [ptoType, setPtoType] = useState<ShopTimeEntryPTOTypeKey | undefined>(undefined);
  const [ptoHours, setPtoHours] = useState<PtoHours>(8);
  const [editingEntryId, setEditingEntryId] = useState<string>('');
  const [editingAssetId, setEditingAssetId] = useState<string>('');
  const [editingAssetRecord, setEditingAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(
    undefined,
  );
  const [editingDivision, setEditingDivision] = useState<string>('');
  const [editingJobNumber, setEditingJobNumber] = useState<string>('');
  const [editingNotesEntryId, setEditingNotesEntryId] = useState<string>('');
  const [editingNotes, setEditingNotes] = useState<string>('');
  const [clockInConfirmation, setClockInConfirmation] = useState<ClockInConfirmation | undefined>(undefined);
  const [isClockingIn, setIsClockingIn] = useState(false);

  const {
    data: shopEmployees = [],
    isLoading: employeesLoading,
    isError: employeesFailed,
    error: employeesError,
    refetch: refetchEmployees,
  } = useShopEmployeeList();
  const employees = useMemo(() => mapShopEmployees(shopEmployees), [shopEmployees]);
  const { data: assets = [], isLoading: assetsLoading, isError: assetsFailed, refetch: refetchAssets } = useAllEquipmentAssets();
  const { data: timeEntries = [], isLoading: entriesLoading, isError: entriesFailed, refetch: refetchEntries } = useShopTimeEntryList();
  const createTimeEntry = useCreateShopTimeEntry();
  const updateTimeEntry = useUpdateShopTimeEntry();

  const selectedEmployee = employees.find((employee: AppShopEmployee) => employee.id === selectedEmployeeId);
  const employeeEntries = useMemo(() => {
    if (!selectedEmployeeId || !selectedEmployee) return [];
    return timeEntries
      .filter((entry: ShopTimeEntry) => entry.employee?.id === selectedEmployee.id)
      .sort(
        (entryA: ShopTimeEntry, entryB: ShopTimeEntry) =>
          new Date(entryB.clockIn ?? '').getTime() - new Date(entryA.clockIn ?? '').getTime(),
      );
  }, [selectedEmployee, selectedEmployeeId, timeEntries]);
  const selectedAsset = selectedAssetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === selectedAssetId);
  const employeeTodayEntries = useMemo(() => {
    if (!selectedEmployeeId || !selectedEmployee) return [];
    const today = format(new Date(), 'yyyy-MM-dd');
    return employeeEntries.filter((entry: ShopTimeEntry) => {
      if (!entry.clockIn) return false;
      const clockIn = new Date(entry.clockIn);
      return !Number.isNaN(clockIn.getTime()) && format(clockIn, 'yyyy-MM-dd') === today;
    });
  }, [employeeEntries, selectedEmployee, selectedEmployeeId]);
  const employeeActiveEntry = employeeTodayEntries.find((entry: ShopTimeEntry) => !entry.clockOut && !isPtoEntry(entry));
  const dayFirstIn = dayFirstClockIn(employeeTodayEntries);
  const dayLastOut = dayLastClockOut(employeeTodayEntries);
  // Road mechanics start whenever they punch in, so their early time is paid
  // rather than being pulled forward to the default start.
  const payStart = scheduledStartFor(selectedEmployee);
  const todayPay = useMemo(() => getDayPayMinutes(employeeTodayEntries, new Date(), payStart), [employeeTodayEntries, payStart]);
  const voicePhrases = useMemo(
    () =>
      [
        ...assets.map((asset: EquipmentAsset) => asset.asset).filter(Boolean),
        selectedEmployee?.employeeName,
        'job',
        'division',
        'handoff',
        'parts',
        'waiting on parts',
      ].filter((value): value is string => Boolean(value)),
    [assets, selectedEmployee?.employeeName],
  );

  const resetEntryForm = () => {
    setSelectedAssetId('');
    setSelectedAssetRecord(undefined);
    setNotes('');
    setDivision('');
    setJobNumber('');
    setAssetFormMode(null);
  };

  // The kiosk can sit on this page all day, so its cached asset and employee
  // lists would otherwise never pick up division changes or new hires.
  const refreshReferenceData = () => {
    void refetchAssets();
    void refetchEmployees();
  };

  const handleAcceptedCode = () => {
    setClockInConfirmation(undefined);
    resetEntryForm();
    setShowPtoForm(false);
    setEditingEntryId('');
    setEditingAssetId('');
    setEditingAssetRecord(undefined);
    setEditingDivision('');
    setEditingJobNumber('');
    setEditingNotesEntryId('');
    setEditingNotes('');
    refreshReferenceData();
  };

  const handleReloadTables = useReloadTables(refetchAssets, refetchEntries);

  const resolveAssetSelection = () => {
    const selectedAssetForEntry = selectedAssetId ? selectedAsset : undefined;
    const manualDivision = division.trim();
    const manualJobNumber = jobNumber.trim();
    if (!selectedAssetForEntry && !manualDivision && !manualJobNumber) {
      return { error: 'An asset, division, or job number is required.' };
    }
    const divisionNumber = manualDivision ? Number(manualDivision) : selectedAssetForEntry?.divisionCode;
    if (manualDivision && !Number.isFinite(divisionNumber)) {
      return { error: 'Division must be a number.' };
    }
    const selectedAssetName = selectedAssetForEntry ? getAssetDisplayName(selectedAssetForEntry) : '';
    const fallbackLabel = [manualDivision ? `Division ${manualDivision}` : '', manualJobNumber ? `Job ${manualJobNumber}` : '']
      .filter((value: string) => value)
      .join(' · ');
    const entryLabel = selectedAssetName
      ? [selectedAssetName, manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ')
      : fallbackLabel || 'Time entry';
    return { selectedAssetForEntry, divisionNumber, selectedAssetName, manualJobNumber, entryLabel };
  };

  const showClockInConfirmation = (details: ClockInConfirmation) => {
    setClockInConfirmation(details);
  };

  const handleClockIn = async () => {
    if (!selectedEmployee) {
      toast.error('Verify your employee code before clocking in.');
      return;
    }
    if (employeeActiveEntry) {
      toast.error('You are already clocked in. Clock out or add a job.');
      return;
    }
    const clockIn = getNowIso();
    setIsClockingIn(true);
    try {
      const pos = await getCurrentPosition();
      await createTimeEntry.mutateAsync({
        timeEntry: `${selectedEmployee.employeeName} - ${AWAITING_ASSET_LABEL}`,
        employee: { id: selectedEmployee.id, autoNumber: selectedEmployee.autoNumber },
        clockIn,
        clockInLat: pos?.lat,
        clockInLon: pos?.lon,
        workDate: getWorkDate(clockIn),
      });
      resetEntryForm();
      toast.success(`Clocked in at ${format(new Date(clockIn), 'p')}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to clock in.');
    } finally {
      setIsClockingIn(false);
    }
  };

  const handleStartAsset = async () => {
    if (!selectedEmployee || !employeeActiveEntry) {
      toast.error('Clock in before starting an asset.');
      return;
    }
    const selection = resolveAssetSelection();
    if ('error' in selection) {
      toast.error(selection.error);
      return;
    }
    const { selectedAssetForEntry, divisionNumber, selectedAssetName, manualJobNumber, entryLabel } = selection;
    const wasWaiting = isAwaitingAsset(employeeActiveEntry);
    const switchAt = getNowIso();
    const closedActiveEntry = { ...employeeActiveEntry, clockOut: switchAt };
    const dayAfterClose = employeeTodayEntries.map((entry: ShopTimeEntry) =>
      entry.id === closedActiveEntry.id ? closedActiveEntry : entry,
    );
    const pos = await getCurrentPosition();
    try {
      await updateTimeEntry.mutateAsync({
        id: closedActiveEntry.id,
        changedFields: {
          clockOut: switchAt,
          hours: getEntryPaidMinutes(dayAfterClose, closedActiveEntry, new Date(), payStart) / 60,
          clockOutLat: pos?.lat,
          clockOutLon: pos?.lon,
        },
      });
      try {
        await createTimeEntry.mutateAsync({
          timeEntry: `${selectedEmployee.employeeName} - ${entryLabel}`,
          employee: { id: selectedEmployee.id, autoNumber: selectedEmployee.autoNumber },
          asset: selectedAssetForEntry ? { id: selectedAssetForEntry.id, asset: selectedAssetName } : undefined,
          assetDivision: divisionNumber,
          division: divisionNumber,
          jobNumber: manualJobNumber || undefined,
          clockIn: switchAt,
          clockInLat: pos?.lat,
          clockInLon: pos?.lon,
          workDate: getWorkDate(switchAt),
          notes: applyNoLunchMarker(notes.trim() || undefined, todayPay.noLunch),
        });
      } catch (createError: unknown) {
        await updateTimeEntry.mutateAsync({
          id: employeeActiveEntry.id,
          changedFields: { clockOut: '', hours: employeeActiveEntry.hours },
        });
        throw createError;
      }
      resetEntryForm();
      showClockInConfirmation({
        employeeName: selectedEmployee.employeeName,
        asset: selectedAssetName || 'Unassigned asset',
        division: divisionNumber === undefined ? '—' : String(divisionNumber),
        jobNumber: manualJobNumber || '—',
        clockIn: switchAt,
      });
      toast.success(
        wasWaiting
          ? `Started ${entryLabel} at ${format(new Date(switchAt), 'p')}.`
          : `Started ${entryLabel}. Previous asset closed at ${format(new Date(switchAt), 'p')}.`,
      );
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to start the next asset.');
    }
  };

  const handleSubmitPto = async () => {
    if (!selectedEmployee || !ptoDate) {
      toast.error('Verify your employee code and choose a PTO date.');
      return;
    }
    if (!ptoType) {
      toast.error('Choose a PTO type.');
      return;
    }
    const clockIn = getPtoClockInIso(ptoDate);
    const clockOut = addHours(new Date(clockIn), ptoHours).toISOString();
    const ptoRecord: Omit<ShopTimeEntry, 'id'> = {
      timeEntry: `${selectedEmployee.employeeName} - PTO`,
      pTOTimeKey: PTO_TIME_KEY_BY_HOURS[ptoHours],
      pTOTypeKey: ptoType,
      ptoApproval: 'Pending',
      employee: { id: selectedEmployee.id, autoNumber: selectedEmployee.autoNumber },
      jobNumber: 'PTO',
      clockIn,
      clockOut,
      hours: ptoHours,
      workDate: getWorkDate(clockIn),
      notes: `${ptoHours} hours ${ShopTimeEntryPTOTypeKeyToLabel[ptoType]} PTO submitted for ${format(ptoDate, 'MMM d, yyyy')}.`,
    };
    try {
      await createTimeEntry.mutateAsync(ptoRecord);
      setShowPtoForm(false);
      setPtoDate(startOfDay(new Date()));
      setPtoHours(8);
      setPtoType(undefined);
      toast.success(`${ptoHours} hours ${ShopTimeEntryPTOTypeKeyToLabel[ptoType]} PTO submitted for ${format(ptoDate, 'MMM d, yyyy')}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit PTO.');
    }
  };

  const handleClockOut = async (entry: ShopTimeEntry) => {
    const clockOut = getNowIso();
    const updatedEntry = { ...entry, clockOut };
    const dayEntries = employeeTodayEntries.map((row: ShopTimeEntry) => (row.id === entry.id ? updatedEntry : row));
    const pos = await getCurrentPosition();
    try {
      await updateTimeEntry.mutateAsync({
        id: entry.id,
        changedFields: {
          clockOut,
          hours: getEntryPaidMinutes(dayEntries, updatedEntry, new Date(), payStart) / 60,
          clockOutLat: pos?.lat,
          clockOutLon: pos?.lon,
        },
      });
      const firstIn = dayFirstClockIn(dayEntries) ?? entry.clockIn;
      toast.success(
        firstIn
          ? `Clocked out at ${format(new Date(clockOut), 'p')}. Day is ${format(new Date(firstIn), 'p')} – ${format(new Date(clockOut), 'p')}.`
          : `Clocked out at ${format(new Date(clockOut), 'p')}.`,
      );
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to clock out.');
    }
  };

  const handleStartEditAsset = (entry: ShopTimeEntry) => {
    setEditingEntryId(entry.id);
    setEditingAssetId(entry.asset?.id ?? '');
    setEditingAssetRecord(entry.asset);
    setEditingDivision(getEntryDivision(entry, assets));
    setEditingJobNumber(getEntryJobNumber(entry));
    setEditingNotesEntryId('');
    setEditingNotes(stripNoLunchMarker(entry.notes));
  };
  const handleCancelEditAsset = () => {
    setEditingEntryId('');
    setEditingAssetId('');
    setEditingAssetRecord(undefined);
    setEditingDivision('');
    setEditingJobNumber('');
    setEditingNotes('');
  };
  const handleSaveEditAsset = async (entry: ShopTimeEntry) => {
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
    try {
      await updateTimeEntry.mutateAsync({
        id: entry.id,
        changedFields: {
          timeEntry: `${employeeName} - ${entryLabel}`,
          asset: newAsset ? { id: newAsset.id, asset: getAssetDisplayName(newAsset) } : entry.asset,
          assetDivision: newAsset ? newAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
          division: newAsset ? newAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
          jobNumber: manualJobNumber || undefined,
          notes: applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || todayPay.noLunch),
        },
      });
      handleCancelEditAsset();
      setEditingNotesEntryId('');
      toast.success('Timecard updated.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update asset.');
    }
  };
  const handleSaveEditNotes = async (entry: ShopTimeEntry) => {
    try {
      await updateTimeEntry.mutateAsync({
        id: entry.id,
        changedFields: { notes: applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || todayPay.noLunch) },
      });
      setEditingNotesEntryId('');
      setEditingNotes('');
      toast.success('Notes updated.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update notes.');
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {!selectedEmployee ? (
        <EmployeeCodeSignIn
          id="employee-code"
          employees={employees}
          loading={employeesLoading}
          failed={employeesFailed}
          error={employeesError}
          onRetry={() => void refetchEmployees()}
          submitLabel="View my timecard"
          onAccepted={handleAcceptedCode}
        />
      ) : (
        <section className="grid gap-6">
          <KioskSessionBar
            employee={selectedEmployee}
            detail={format(new Date(), 'EEEE, MMM d')}
            onLeave={handleAcceptedCode}
            actions={
              <Button type="button" variant="outline" onClick={() => void handleReloadTables()} disabled={assetsLoading || entriesLoading}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reload tables
              </Button>
            }
          />
          {clockInConfirmation ? (
            <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center" role="status" aria-live="polite">
                <div className="rounded-full bg-primary p-3 text-primary-foreground">
                  <Check className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xl font-semibold">Clock-in recorded for {clockInConfirmation.employeeName}.</p>
                  <p className="mt-1 text-sm text-muted-foreground">{format(new Date(clockInConfirmation.clockIn), 'p')}</p>
                </div>
                <dl className="grid w-full max-w-2xl gap-2 text-left sm:grid-cols-3">
                  <div className="rounded-lg bg-muted p-4 text-muted-foreground">
                    <dt className="text-xs font-medium">Asset</dt>
                    <dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.asset}</dd>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-muted-foreground">
                    <dt className="text-xs font-medium">Division</dt>
                    <dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.division}</dd>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-muted-foreground">
                    <dt className="text-xs font-medium">Job number</dt>
                    <dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.jobNumber}</dd>
                  </div>
                </dl>
                <Button type="button" onClick={() => setClockInConfirmation(undefined)}>
                  Continue
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="bg-card text-card-foreground shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-1">
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <TimerReset className="h-5 w-5" /> Today’s asset timecard
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Clock in when you arrive. Add a job when work begins, and again to change equipment. After clock-out, add
                      forgotten jobs on Mechanic Log.
                    </p>
                    {dayFirstIn ? (
                      <p className="text-sm font-medium text-foreground">
                        Day clock-in {format(new Date(dayFirstIn), 'p')}
                        {dayLastOut
                          ? ` · Day clock-out ${format(new Date(dayLastOut), 'p')}`
                          : employeeActiveEntry
                            ? ' · still clocked in'
                            : ''}
                      </p>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {assetsFailed || entriesFailed ? (
                    <Card className="border-l-4 border-l-destructive bg-card text-card-foreground shadow-sm">
                      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold">Timecard data is unavailable</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Check Dataverse access to Equipment Asset and Shop Time Entry, then retry.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void refetchAssets();
                            void refetchEntries();
                          }}
                        >
                          Retry
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}
                  {entriesLoading ? <p className="text-sm text-muted-foreground">Loading your timecard...</p> : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {!employeeActiveEntry ? (
                      <Button
                        type="button"
                        size="lg"
                        className="h-14 flex-1 justify-center text-base font-semibold shadow-sm"
                        onClick={() => void handleClockIn()}
                        disabled={isClockingIn || createTimeEntry.isPending}
                      >
                        {isClockingIn ? 'Clocking in…' : 'Clock in'}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="lg"
                        className="h-14 flex-1 justify-center bg-blue-700 text-base font-semibold text-white hover:bg-blue-800"
                        onClick={() => setAssetFormMode('start-asset')}
                      >
                        <Plus className="mr-2 h-5 w-5" /> Add job
                      </Button>
                    )}
                  </div>
                  {assetFormMode ? (
                    <div className="grid gap-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">Add job</p>
                        <Button type="button" size="icon" variant="ghost" aria-label="Cancel form" onClick={() => setAssetFormMode(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label>Equipment asset</Label>
                        <AssetPicker
                          assets={assets}
                          value={selectedAssetId}
                          onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => {
                            setSelectedAssetRecord(asset);
                            setSelectedAssetId(asset?.id ?? '');
                            setDivision(asset?.divisionCode === undefined ? '' : String(asset.divisionCode));
                          }}
                          currentAsset={selectedAssetRecord}
                        />
                        <p className="text-sm text-muted-foreground">
                          Choose any equipment asset, or leave it blank and enter a division or job number below.
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="division">Division (optional)</Label>
                          <Input
                            id="division"
                            className="bg-background"
                            value={division}
                            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDivision(event.target.value)}
                            placeholder="Mapped from asset or enter division"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="job-number">Job Number (optional)</Label>
                          <Input
                            id="job-number"
                            className="bg-background"
                            value={jobNumber}
                            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobNumber(event.target.value)}
                            placeholder="Enter job number"
                          />
                        </div>
                      </div>
                      {employeeActiveEntry && !isAwaitingAsset(employeeActiveEntry) ? (
                        <div className="rounded-lg border border-border bg-background p-3 text-muted-foreground">
                          <p className="font-medium text-foreground">Current asset: {getEntryAssetName(employeeActiveEntry, assets)}</p>
                          <p className="text-sm">Starting another asset clocks this one out now and keeps the day’s clock-in.</p>
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Notes</Label>
                          <VoiceNoteButton
                            value={notes}
                            onChange={setNotes}
                            phrases={voicePhrases}
                            disabled={createTimeEntry.isPending || updateTimeEntry.isPending}
                          />
                        </div>
                        <Textarea
                          className="bg-background"
                          value={notes}
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
                          placeholder="Optional job notes or handoff details"
                        />
                      </div>
                      <Button
                        className="h-12"
                        type="button"
                        onClick={() => void handleStartAsset()}
                        disabled={assetsLoading || createTimeEntry.isPending || updateTimeEntry.isPending}
                      >
                        Add job
                      </Button>
                    </div>
                  ) : null}
                  {employeeTodayEntries.length === 0 && !entriesLoading && !assetFormMode ? (
                    <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                      Clock in when you arrive, even if the job has not started. Use Add job when you begin work.
                    </p>
                  ) : null}
                  {employeeTodayEntries.map((entry: ShopTimeEntry) => (
                    <div key={entry.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <div>
                          {editingEntryId === entry.id && !isPtoEntry(entry) ? (
                            <div className="max-w-md space-y-3">
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
                                    value={editingJobNumber}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditingJobNumber(event.target.value)}
                                    placeholder="Optional job note"
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
                                  value={editingNotes}
                                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)}
                                  placeholder="Add notes for this time entry"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {isPtoEntry(entry) ? <Badge variant="secondary">PTO</Badge> : null}
                                {entry.pTOTypeKey ? (
                                  <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge>
                                ) : null}
                                <p className="text-sm text-muted-foreground">
                                  {isPtoEntry(entry) ? 'Paid time off' : isAwaitingAsset(entry) ? 'Clocked in' : 'Asset'}
                                </p>
                              </div>
                              <p className="text-lg font-semibold">
                                {isAwaitingAsset(entry) ? 'Clocked in' : getEntryAssetName(entry, assets)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {isPtoEntry(entry)
                                  ? `${getPtoHours(entry) || Math.round(entry.hours ?? 0)} hours submitted`
                                  : isAwaitingAsset(entry)
                                    ? 'Add a job when work begins.'
                                    : `Division ${getEntryDivision(entry, assets) || '—'} · Job ${getEntryJobNumber(entry) || '—'}`}
                              </p>
                            </div>
                          )}
                          {editingNotesEntryId === entry.id ? (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <Label htmlFor={`notes-${entry.id}`}>Notes</Label>
                                <VoiceNoteButton
                                  value={editingNotes}
                                  onChange={setEditingNotes}
                                  phrases={voicePhrases}
                                  disabled={updateTimeEntry.isPending}
                                />
                              </div>
                              <Textarea
                                id={`notes-${entry.id}`}
                                value={editingNotes}
                                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)}
                                placeholder="Add notes for this time entry"
                              />
                            </div>
                          ) : stripNoLunchMarker(entry.notes) && editingEntryId !== entry.id ? (
                            <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">{stripNoLunchMarker(entry.notes)}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <div className="space-y-2 text-left sm:text-right">
                            <div>
                              <p className="text-sm text-muted-foreground">Clock in</p>
                              <p className="text-lg font-semibold">{entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Clock out</p>
                              <p className="text-lg font-semibold">{entry.clockOut ? format(new Date(entry.clockOut), 'p') : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Duration</p>
                              <p className="text-sm font-medium text-foreground">{formatDuration(getRawDurationMinutes(entry))}</p>
                            </div>
                          </div>
                          {editingEntryId === entry.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                type="button"
                                size="icon"
                                aria-label="Save timecard"
                                onClick={() => void handleSaveEditAsset(entry)}
                                disabled={updateTimeEntry.isPending}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button type="button" size="icon" variant="outline" aria-label="Cancel edit" onClick={handleCancelEditAsset}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : editingNotesEntryId === entry.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                type="button"
                                size="icon"
                                aria-label="Save notes"
                                onClick={() => void handleSaveEditNotes(entry)}
                                disabled={updateTimeEntry.isPending}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                aria-label="Cancel notes edit"
                                onClick={() => setEditingNotesEntryId('')}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {!entry.clockOut && isAwaitingAsset(entry) ? (
                                <Badge variant="secondary">Clocked in</Badge>
                              ) : !entry.clockOut && !isPtoEntry(entry) ? (
                                <Badge variant="secondary">Active</Badge>
                              ) : (
                                <Badge variant="outline">Complete</Badge>
                              )}
                              {!isPtoEntry(entry) ? (
                                <Button type="button" variant="outline" onClick={() => handleStartEditAsset(entry)}>
                                  Edit timecard
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setEditingEntryId('');
                                  setEditingNotesEntryId(entry.id);
                                  setEditingNotes(stripNoLunchMarker(entry.notes));
                                }}
                              >
                                {stripNoLunchMarker(entry.notes) ? 'Edit notes' : 'Add notes'}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {employeeActiveEntry ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          size="lg"
                          variant="destructive"
                          className="h-14 w-full justify-center text-base font-semibold"
                          disabled={updateTimeEntry.isPending}
                        >
                          Clock out
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confirm clock out for the day?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Clock out ends the day for {selectedEmployee.employeeName}
                            {dayFirstIn ? `, started at ${format(new Date(dayFirstIn), 'p')}` : ''}.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Stay clocked in</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void handleClockOut(employeeActiveEntry)} disabled={updateTimeEntry.isPending}>
                            Clock out
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="bg-card text-card-foreground shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl">
                        <CalendarIcon className="h-5 w-5" /> PTO
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">Submit 4 or 8 hours of paid time off for a past or future day.</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => setShowPtoForm((currentValue: boolean) => !currentValue)}>
                      {showPtoForm ? 'Cancel PTO' : 'Submit PTO'}
                    </Button>
                  </div>
                </CardHeader>
                {showPtoForm ? (
                  <CardContent className="grid gap-4 rounded-b-xl border-t border-border bg-muted p-4 text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>PTO date</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="outline" className="w-full justify-start bg-background text-left font-normal">
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {ptoDate ? format(ptoDate, 'MMM d, yyyy') : 'Pick a date'}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={ptoDate}
                              onSelect={(date: Date | undefined) => {
                                if (date) setPtoDate(startOfDay(date));
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="pto-type">PTO type</Label>
                        <Select value={ptoType} onValueChange={(value: ShopTimeEntryPTOTypeKey) => setPtoType(value)}>
                          <SelectTrigger id="pto-type" className="w-full bg-background">
                            <SelectValue placeholder="Select PTO type" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ShopTimeEntryPTOTypeKeyToLabel)
                              .filter(([key]: [string, string]) => Boolean(key))
                              .map(([key, label]: [string, string]) => (
                                <SelectItem key={key} value={key}>
                                  {label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>PTO hours</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" variant={ptoHours === 4 ? 'default' : 'outline'} onClick={() => setPtoHours(4)}>
                            4 hours
                          </Button>
                          <Button type="button" variant={ptoHours === 8 ? 'default' : 'outline'} onClick={() => setPtoHours(8)}>
                            8 hours
                          </Button>
                        </div>
                      </div>
                    </div>
                    <Button className="h-12" type="button" onClick={() => void handleSubmitPto()} disabled={createTimeEntry.isPending}>
                      Submit PTO
                    </Button>
                  </CardContent>
                ) : null}
              </Card>
            </>
          )}
        </section>
      )}
    </main>
  );
}
