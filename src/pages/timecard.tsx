import { useMemo, useRef, useState } from 'react';
import { addHours, format, startOfDay } from 'date-fns';
import { CalendarIcon, Check, Clock, Plus, RefreshCw, TimerReset, X } from 'lucide-react';
import { toast } from 'sonner';

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
import { useAllEquipmentAssets, useCreateShopTimeEntry, useShopEmployeeList, useShopTimeEntryList, useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import {
  applyNoLunchMarker,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  isPtoEntry,
  notesHaveNoLunch,
  roundClockInUpToQuarterHour,
  stripNoLunchMarker,
} from '@/lib/time-rules';
import { getAssetDisplayName, getTimeEntryAssetName, getEntryJobNumber, PTO_TIME_KEY_BY_HOURS, getPtoClockInIso } from '@/lib/entry-helpers';
import { ShopTimeEntryPTOTypeKeyToLabel, DEFAULT_PAY_TYPE, type ShopTimeEntry, type ShopTimeEntryPTOTypeKey } from '@/models/shop-time-entry';

type PtoHours = 4 | 8;
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
  const [employeeCode, setEmployeeCode] = useState<string>('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [selectedAssetRecord, setSelectedAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(undefined);
  const [division, setDivision] = useState<string>('');
  const [jobNumber, setJobNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [showAddAsset, setShowAddAsset] = useState<boolean>(false);
  const [showPtoForm, setShowPtoForm] = useState<boolean>(false);
  const [ptoDate, setPtoDate] = useState<Date | undefined>(startOfDay(new Date()));
  const [ptoType, setPtoType] = useState<ShopTimeEntryPTOTypeKey | undefined>(undefined);
  const [ptoHours, setPtoHours] = useState<PtoHours>(8);
  const [editingEntryId, setEditingEntryId] = useState<string>('');
  const [editingAssetId, setEditingAssetId] = useState<string>('');
  const [editingAssetRecord, setEditingAssetRecord] = useState<Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined>(undefined);
  const [editingDivision, setEditingDivision] = useState<string>('');
  const [editingJobNumber, setEditingJobNumber] = useState<string>('');
  const [editingNotesEntryId, setEditingNotesEntryId] = useState<string>('');
  const [editingNotes, setEditingNotes] = useState<string>('');
  const returnToSignInTimer = useRef<number | undefined>(undefined);
  const [clockInConfirmation, setClockInConfirmation] = useState<ClockInConfirmation | undefined>(undefined);

  const { data: shopEmployees = [], isLoading: employeesLoading, isError: employeesFailed, error: employeesError, refetch: refetchEmployees } = useShopEmployeeList();
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
      .sort((entryA: ShopTimeEntry, entryB: ShopTimeEntry) => new Date(entryB.clockIn ?? '').getTime() - new Date(entryA.clockIn ?? '').getTime());
  }, [selectedEmployee, selectedEmployeeId, timeEntries]);
  const selectedAsset = selectedAssetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === selectedAssetId);
  const employeeTodayEntries = useMemo(() => {
    if (!selectedEmployeeId || !selectedEmployee) return [];
    const today = format(new Date(), 'yyyy-MM-dd');
    return employeeEntries.filter((entry: ShopTimeEntry) => entry.clockIn?.startsWith(today));
  }, [employeeEntries, selectedEmployee, selectedEmployeeId]);
  const employeeActiveEntry = employeeTodayEntries.find((entry: ShopTimeEntry) => !entry.clockOut && !isPtoEntry(entry));
  const todayPay = useMemo(() => getDayPayMinutes(employeeTodayEntries), [employeeTodayEntries]);
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
    setShowAddAsset(false);
  };

  const handleEmployeeCodeSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const matchedEmployee = employees.find((employee: AppShopEmployee) => employee.employeeCode === Number(employeeCode.trim()));
    if (!matchedEmployee) {
      setSelectedEmployeeId('');
      resetEntryForm();
      toast.error('Employee code not found. Enter your 4 digit employee number.');
      return;
    }
    setSelectedEmployeeId(matchedEmployee.id);
    resetEntryForm();
    toast.success(`Verified ${matchedEmployee.employeeName}.`);
  };

  const handleResetEmployee = () => {
    if (returnToSignInTimer.current !== undefined) {
      window.clearTimeout(returnToSignInTimer.current);
      returnToSignInTimer.current = undefined;
    }
    setClockInConfirmation(undefined);
    setEmployeeCode('');
    setSelectedEmployeeId('');
    resetEntryForm();
    setShowPtoForm(false);
  };

  const handleReloadTables = async () => {
    try {
      await Promise.all([refetchAssets(), refetchEntries()]);
      toast.success('Equipment assets and shop time entries reloaded.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to reload table data.');
    }
  };

  const handleClockIn = async () => {
    if (!selectedEmployee) {
      toast.error('Verify your employee code before clocking in.');
      return;
    }
    const nowIso = getNowIso();
    const isFirstLaborClockIn = !employeeTodayEntries.some((entry: ShopTimeEntry) => !isPtoEntry(entry));
    const clockIn = isFirstLaborClockIn ? roundClockInUpToQuarterHour(nowIso) : nowIso;
    const selectedAssetForEntry = selectedAssetId ? selectedAsset : undefined;
    const manualDivision = division.trim();
    const manualJobNumber = jobNumber.trim();
    if (!selectedAssetForEntry && !manualDivision && !manualJobNumber) {
      toast.error('An asset, division, or job number is required to clock in.');
      return;
    }
    const divisionNumber = manualDivision ? Number(manualDivision) : selectedAssetForEntry?.divisionCode;
    if (manualDivision && !Number.isFinite(divisionNumber)) {
      toast.error('Division must be a number.');
      return;
    }
    const selectedAssetName = selectedAssetForEntry ? getAssetDisplayName(selectedAssetForEntry) : '';
    const fallbackLabel = [manualDivision ? `Division ${manualDivision}` : '', manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ');
    const entryLabel = selectedAssetName ? [selectedAssetName, manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ') : fallbackLabel || 'Time entry';
    const closedActiveEntry = employeeActiveEntry ? { ...employeeActiveEntry, clockOut: clockIn } : undefined;
    const dayAfterClose = closedActiveEntry
      ? employeeTodayEntries.map((entry: ShopTimeEntry) => (entry.id === closedActiveEntry.id ? closedActiveEntry : entry))
      : employeeTodayEntries;
    try {
      if (closedActiveEntry) {
        await updateTimeEntry.mutateAsync({
          id: closedActiveEntry.id,
          changedFields: { clockOut: clockIn, hours: getEntryPaidMinutes(dayAfterClose, closedActiveEntry) / 60 },
        });
      }
      await createTimeEntry.mutateAsync({
        timeEntry: `${selectedEmployee.employeeName} - ${entryLabel}`,
        employee: { id: selectedEmployee.id, autoNumber: selectedEmployee.autoNumber },

        asset: selectedAssetForEntry ? { id: selectedAssetForEntry.id, asset: selectedAssetName } : undefined,
        assetDivision: divisionNumber,
        division: divisionNumber,
        jobNumber: manualJobNumber || undefined,
        clockIn,
        workDate: getWorkDate(clockIn),
        notes: applyNoLunchMarker(notes.trim() || undefined, todayPay.noLunch),
      });
      resetEntryForm();
      setClockInConfirmation({
        employeeName: selectedEmployee.employeeName,
        asset: selectedAssetName || 'Unassigned asset',
        division: divisionNumber === undefined ? '—' : String(divisionNumber),
        jobNumber: manualJobNumber || '—',
        clockIn,
      });
      toast.success(employeeActiveEntry ? 'Previous time entry closed and new entry started.' : 'Clocked in successfully.');
      returnToSignInTimer.current = window.setTimeout(() => {
        setClockInConfirmation(undefined);
        setEmployeeCode('');
        setSelectedEmployeeId('');
        setShowPtoForm(false);
        returnToSignInTimer.current = undefined;
      }, 3000);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to clock in.');
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
    try {
      await updateTimeEntry.mutateAsync({ id: entry.id, changedFields: { clockOut, hours: getEntryPaidMinutes(dayEntries, updatedEntry) / 60 } });
      toast.success('Clocked out successfully.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to clock out.');
    }
  };

  const handleStartEditAsset = (entry: ShopTimeEntry) => {
    setEditingEntryId(entry.id);
    setEditingAssetId(entry.asset?.id ?? '');
    setEditingAssetRecord(entry.asset);
    setEditingDivision(entry.assetDivision !== undefined ? String(entry.assetDivision) : '');
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
    const newAsset = editingAssetId ? editingAssetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === editingAssetId) : undefined;
    const manualDivision = editingDivision.trim();
    const manualJobNumber = editingJobNumber.trim();
    if (manualDivision && !Number.isFinite(Number(manualDivision))) {
      toast.error('Division must be a number.');
      return;
    }
    const assetLabel = newAsset ? getAssetDisplayName(newAsset) : getTimeEntryAssetName(entry, assets);
    const entryLabel = [assetLabel, manualJobNumber ? `Job ${manualJobNumber}` : ''].filter((value: string) => value).join(' · ') || (manualDivision ? `Division ${manualDivision}` : 'Time entry');
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
      await updateTimeEntry.mutateAsync({ id: entry.id, changedFields: { notes: applyNoLunchMarker(editingNotes.trim() || undefined, notesHaveNoLunch(entry.notes) || todayPay.noLunch) } });
      setEditingNotesEntryId('');
      setEditingNotes('');
      toast.success('Notes updated.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update notes.');
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {clockInConfirmation ? (
        <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center" role="status" aria-live="polite">
            <div className="rounded-full bg-primary p-3 text-primary-foreground"><Check className="h-6 w-6" /></div>
            <div>
              <p className="text-xl font-semibold">Clock-in recorded for {clockInConfirmation.employeeName}.</p>
              <p className="mt-1 text-sm text-muted-foreground">{format(new Date(clockInConfirmation.clockIn), 'p')}</p>
            </div>
            <dl className="grid w-full max-w-2xl gap-2 text-left sm:grid-cols-3">
              <div className="rounded-lg bg-muted p-4 text-muted-foreground"><dt className="text-xs font-medium">Asset</dt><dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.asset}</dd></div>
              <div className="rounded-lg bg-muted p-4 text-muted-foreground"><dt className="text-xs font-medium">Division</dt><dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.division}</dd></div>
              <div className="rounded-lg bg-muted p-4 text-muted-foreground"><dt className="text-xs font-medium">Job number</dt><dd className="mt-1 text-base font-semibold text-foreground">{clockInConfirmation.jobNumber}</dd></div>
            </dl>
            <p className="text-sm text-muted-foreground">Returning to employee sign-in...</p>
          </CardContent>
        </Card>
      ) : !selectedEmployee ? (
        <Card className="bg-card text-card-foreground shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Clock className="h-5 w-5" /> Sign in</CardTitle></CardHeader>
          <CardContent>
            <form className="mx-auto grid max-w-sm gap-3" onSubmit={handleEmployeeCodeSubmit}>
              <Label htmlFor="employee-code">Employee code</Label>
              <Input id="employee-code" inputMode="numeric" maxLength={4} pattern="[0-9]*" type="password" value={employeeCode} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmployeeCode(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="****" />
              {employeesFailed ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">Could not load shop employees from Dataverse.</p>
                  <p className="mt-1 break-words text-destructive/80">{employeesError instanceof Error ? employeesError.message : 'Grant the app user Read on Shop Employee, then retry.'}</p>
                  <Button type="button" variant="outline" className="mt-3" onClick={() => void refetchEmployees()}>Retry</Button>
                </div>
              ) : null}
              <Button className="h-12" type="submit" disabled={employeesLoading || employeesFailed || employeeCode.trim().length === 0}>View my timecard</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-6">
          <Card className="bg-card text-card-foreground shadow-sm">
            <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-xl">{selectedEmployee.employeeName}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Employee {selectedEmployee.employeeCode} · {format(new Date(), 'EEEE, MMM d')}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void handleReloadTables()} disabled={assetsLoading || entriesLoading}><RefreshCw className="mr-2 h-4 w-4" /> Reload tables</Button><Button type="button" variant="outline" onClick={handleResetEmployee}>Change employee</Button></div></div></CardHeader>
          </Card>


          <Card className="bg-card text-card-foreground shadow-sm">
            <CardHeader><div className="flex flex-col gap-1"><CardTitle className="flex items-center gap-2 text-xl"><TimerReset className="h-5 w-5" /> Today’s asset timecard</CardTitle><p className="text-sm text-muted-foreground">Asset on the left, clock-in time and actions on the right.</p></div></CardHeader>
            <CardContent className="space-y-3">
          {assetsFailed || entriesFailed ? <Card className="border-l-4 border-l-destructive bg-card text-card-foreground shadow-sm"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Timecard data is unavailable</p><p className="mt-1 text-sm text-muted-foreground">Check Dataverse access to Equipment Asset and Shop Time Entry, then retry.</p></div><Button type="button" variant="outline" onClick={() => { void refetchAssets(); void refetchEntries(); }}>Retry</Button></CardContent></Card> : null}
              {entriesLoading ? <p className="text-sm text-muted-foreground">Loading your timecard...</p> : null}
              {employeeTodayEntries.length === 0 && !entriesLoading && !showAddAsset ? <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No asset time has been recorded today. Select Add to clock in or submit PTO.</p> : null}
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
                              <Input id={`edit-division-${entry.id}`} value={editingDivision} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditingDivision(event.target.value.replace(/\D/g, ''))} placeholder="Optional division code" />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-job-${entry.id}`}>Job number</Label>
                              <Input id={`edit-job-${entry.id}`} value={editingJobNumber} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditingJobNumber(event.target.value)} placeholder="Optional job note" />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor={`edit-notes-${entry.id}`}>Notes</Label>
                              <VoiceNoteButton value={editingNotes} onChange={setEditingNotes} phrases={voicePhrases} disabled={updateTimeEntry.isPending} />
                            </div>
                            <Textarea id={`edit-notes-${entry.id}`} value={editingNotes} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)} placeholder="Add notes for this time entry" />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1"><div className="flex flex-wrap items-center gap-2">{isPtoEntry(entry) ? <Badge variant="secondary">PTO</Badge> : null}{entry.pTOTypeKey ? <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge> : null}<p className="text-sm text-muted-foreground">{isPtoEntry(entry) ? 'Paid time off' : 'Asset'}</p></div><p className="text-lg font-semibold">{getTimeEntryAssetName(entry, assets)}</p><p className="text-sm text-muted-foreground">{isPtoEntry(entry) ? `${getPtoHours(entry) || Math.round(entry.hours ?? 0)} hours submitted` : `Division ${entry.assetDivision ?? '—'} · Job ${getEntryJobNumber(entry) || '—'}`}</p></div>
                      )}
                      {editingNotesEntryId === entry.id ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor={`notes-${entry.id}`}>Notes</Label>
                            <VoiceNoteButton value={editingNotes} onChange={setEditingNotes} phrases={voicePhrases} disabled={updateTimeEntry.isPending} />
                          </div>
                          <Textarea id={`notes-${entry.id}`} value={editingNotes} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingNotes(event.target.value)} placeholder="Add notes for this time entry" />
                        </div>
                      ) : stripNoLunchMarker(entry.notes) && editingEntryId !== entry.id ? (
                        <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">{stripNoLunchMarker(entry.notes)}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:items-end">
                      <div className="space-y-2 text-left sm:text-right"><div><p className="text-sm text-muted-foreground">Clock in</p><p className="text-lg font-semibold">{entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'}</p></div><div><p className="text-sm text-muted-foreground">Clock out</p><p className="text-lg font-semibold">{entry.clockOut ? format(new Date(entry.clockOut), 'p') : '—'}</p></div><div><p className="text-xs text-muted-foreground">Duration</p><p className="text-sm font-medium text-foreground">{formatDuration(getEntryPaidMinutes(employeeTodayEntries, entry))}</p></div></div>
                      {editingEntryId === entry.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button type="button" size="icon" aria-label="Save timecard" onClick={() => void handleSaveEditAsset(entry)} disabled={updateTimeEntry.isPending}><Check className="h-4 w-4" /></Button>
                          <Button type="button" size="icon" variant="outline" aria-label="Cancel edit" onClick={handleCancelEditAsset}><X className="h-4 w-4" /></Button>
                        </div>
                      ) : editingNotesEntryId === entry.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button type="button" size="icon" aria-label="Save notes" onClick={() => void handleSaveEditNotes(entry)} disabled={updateTimeEntry.isPending}><Check className="h-4 w-4" /></Button>
                          <Button type="button" size="icon" variant="outline" aria-label="Cancel notes edit" onClick={() => setEditingNotesEntryId('')}><X className="h-4 w-4" /></Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!entry.clockOut && !isPtoEntry(entry) ? (
                            <Button type="button" variant="secondary" onClick={() => void handleClockOut(entry)} disabled={updateTimeEntry.isPending}>Clock out</Button>
                          ) : (
                            <Badge variant="outline">Complete</Badge>
                          )}
                          {!isPtoEntry(entry) ? (
                            <Button type="button" variant="outline" onClick={() => handleStartEditAsset(entry)}>Edit timecard</Button>
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
              {!showAddAsset ? <Button type="button" variant="outline" className="w-full justify-center border-dashed" onClick={() => setShowAddAsset(true)}><Plus className="mr-2 h-4 w-4" /> Add</Button> : <div className="grid gap-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground"><div className="flex items-center justify-between gap-3"><p className="font-medium text-foreground">Add asset time</p><Button type="button" size="icon" variant="ghost" aria-label="Cancel add asset" onClick={() => setShowAddAsset(false)}><X className="h-4 w-4" /></Button></div><div className="space-y-2"><Label>Equipment asset</Label><AssetPicker assets={assets} value={selectedAssetId} onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => { setSelectedAssetRecord(asset); setSelectedAssetId(asset?.id ?? ''); setDivision(asset?.divisionCode === undefined ? '' : String(asset.divisionCode)); }} currentAsset={selectedAssetRecord} /><p className="text-sm text-muted-foreground">Choose any equipment asset, or leave it blank and enter a division or job number below.</p></div><div className="space-y-2"><div className="flex items-center justify-between gap-2"><Label>Notes</Label><VoiceNoteButton value={notes} onChange={setNotes} phrases={voicePhrases} disabled={createTimeEntry.isPending || updateTimeEntry.isPending} /></div><Textarea className="bg-background" value={notes} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)} placeholder="Optional job notes or handoff details" /></div>{employeeActiveEntry ? <div className="rounded-lg border border-border bg-background p-3 text-muted-foreground"><p className="font-medium text-foreground">Current active asset: {getTimeEntryAssetName(employeeActiveEntry, assets)}</p><p className="text-sm">Starting another asset will clock out this row first.</p></div> : null}<div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="division">Division (optional)</Label><Input id="division" className="bg-background" value={division} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDivision(event.target.value)} placeholder="Mapped from asset or enter division" /></div><div className="space-y-2"><Label htmlFor="job-number">Job Number (optional)</Label><Input id="job-number" className="bg-background" value={jobNumber} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setJobNumber(event.target.value)} placeholder="Enter job number" /></div></div><Button className="h-12" type="button" onClick={handleClockIn} disabled={assetsLoading || createTimeEntry.isPending || updateTimeEntry.isPending}>Clock in</Button></div>}
            </CardContent>
          </Card>

          <Card className="bg-card text-card-foreground shadow-sm">
            <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-xl"><CalendarIcon className="h-5 w-5" /> PTO</CardTitle><p className="mt-1 text-sm text-muted-foreground">Submit 4 or 8 hours of paid time off for a past or future day.</p></div><Button type="button" variant="outline" onClick={() => setShowPtoForm((currentValue: boolean) => !currentValue)}>{showPtoForm ? 'Cancel PTO' : 'Submit PTO'}</Button></div></CardHeader>
            {showPtoForm ? (
              <CardContent className="grid gap-4 rounded-b-xl border-t border-border bg-muted p-4 text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2"><Label>PTO date</Label><Popover><PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start bg-background text-left font-normal"><CalendarIcon className="mr-2 h-4 w-4" />{ptoDate ? format(ptoDate, 'MMM d, yyyy') : 'Pick a date'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={ptoDate} onSelect={(date: Date | undefined) => { if (date) setPtoDate(startOfDay(date)); }} initialFocus /></PopoverContent></Popover></div>
                  <div className="space-y-2"><Label htmlFor="pto-type">PTO type</Label><Select value={ptoType} onValueChange={(value: ShopTimeEntryPTOTypeKey) => setPtoType(value)}><SelectTrigger id="pto-type" className="w-full bg-background"><SelectValue placeholder="Select PTO type" /></SelectTrigger><SelectContent>{Object.entries(ShopTimeEntryPTOTypeKeyToLabel).filter(([key]: [string, string]) => Boolean(key)).map(([key, label]: [string, string]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>PTO hours</Label><div className="grid grid-cols-2 gap-2"><Button type="button" variant={ptoHours === 4 ? 'default' : 'outline'} onClick={() => setPtoHours(4)}>4 hours</Button><Button type="button" variant={ptoHours === 8 ? 'default' : 'outline'} onClick={() => setPtoHours(8)}>8 hours</Button></div></div>
                </div>
                <Button className="h-12" type="button" onClick={() => void handleSubmitPto()} disabled={createTimeEntry.isPending}>Submit PTO</Button>
              </CardContent>
            ) : null}
          </Card>
        </section>
      )}
      <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-semibold">Daily equipment timecard</p><p className="mt-1 text-sm text-muted-foreground">{todayPay.lunchDeducted ? '30-minute lunch deducted. Asset time is rounded to the nearest 15 minutes.' : todayPay.noLunch ? 'No lunch deducted. Asset time is rounded to the nearest 15 minutes.' : 'Today’s rounded asset time and PTO at a glance.'}</p></div><div className="grid grid-cols-3 gap-2 text-center sm:min-w-80"><div className="rounded-md bg-muted px-3 py-2 text-muted-foreground"><p className="text-xs">Entries</p><p className="text-lg font-semibold text-foreground">{employeeTodayEntries.length}</p></div><div className="rounded-md bg-muted px-3 py-2 text-muted-foreground"><p className="text-xs">Hours</p><p className="text-lg font-semibold text-foreground">{selectedEmployee ? (todayPay.totalMinutes / 60).toFixed(1) : '0.0'}</p></div><div className="rounded-md bg-muted px-3 py-2 text-muted-foreground"><p className="text-xs">Status</p><p className="text-sm font-semibold text-foreground">{employeeActiveEntry ? 'Clocked in' : 'Ready'}</p></div></div></CardContent></Card>
    </main>
  );
}
