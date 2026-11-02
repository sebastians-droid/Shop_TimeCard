import { useQueryClient } from '@tanstack/react-query';
import { addHours, format } from 'date-fns';
import { toast } from '@/lib/toast';

import { useDayNoLunch } from '@/hooks/use-day-no-lunch';
import { buildJobDetails, divisionFields } from '@/lib/job-details';
import { useCreateShopTimeEntry, useDeleteShopTimeEntry, useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import { fetchPayStart } from '@/hooks/use-employee-scheduled-starts';
import {
  PTO_TIME_KEY_BY_HOURS,
  formatTimeForInput,
  getAssetDisplayName,
  getEntryAssetName,
  getEntryEmployeeKey,
  getEntryEmployeeName,
  getEntryWorkDateKey,
  getPtoClockInIso,
  isClockInOnlyRow,
  timeAfter,
  timeNear,
  timeOnWorkDay,
  type PtoHours,
} from '@/lib/entry-helpers';
import {
  applyNoLunchMarker,
  entryWorkDateKey,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  isAwaitingAsset,
  isPtoEntry,
  notesHaveAutoClockOut,
  notesHaveNoLunch,
} from '@/lib/time-rules';
import type { AppShopEmployee } from '@/lib/shop-employees';
import type { EditableEntry, NewEntryDraft, PtoDraft } from '@/lib/manager-timecard';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { ShopTimeEntryPTOTypeKeyToLabel } from '@/models/shop-time-entry';
import type { ShopTimeEntry, ShopTimeEntryPTOApprovalKey } from '@/models/shop-time-entry';

type ManagerEntryActionsInput = {
  employees: AppShopEmployee[];
  assets: EquipmentAsset[];
  timeEntries: ShopTimeEntry[];
};

/** Resolves the asset behind a draft, preferring the record captured in the form. */
function resolveDraftAsset(draft: EditableEntry, assets: EquipmentAsset[]) {
  if (!draft.assetId) return undefined;
  return draft.assetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === draft.assetId);
}

/** "9:00 PM–1:30 AM (next day)", so an overnight save reads as intended rather than backwards. */
function formatSpan(clockIn: string, clockOut?: string) {
  if (!clockOut) return `${format(new Date(clockIn), 'p')}–still clocked in`;
  const nextDay = format(new Date(clockOut), 'yyyy-MM-dd') !== format(new Date(clockIn), 'yyyy-MM-dd');
  return `${format(new Date(clockIn), 'p')}–${format(new Date(clockOut), 'p')}${nextDay ? ' (next day)' : ''}`;
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Write operations for the manager timecard views.
 *
 * The daily list and the per-employee date range view perform the same saves
 * against different target days, so they share these actions and differ only in
 * the `day` they pass. Each action reports its own toast and resolves to whether
 * the write succeeded, leaving form state to the caller.
 */
export function useManagerEntryActions({ employees, assets, timeEntries }: ManagerEntryActionsInput) {
  const queryClient = useQueryClient();
  const createTimeEntry = useCreateShopTimeEntry();
  const updateTimeEntry = useUpdateShopTimeEntry();
  const deleteTimeEntryMutation = useDeleteShopTimeEntry();
  const { setDayNoLunch, lunchUpdatingKey } = useDayNoLunch();

  const findEmployee = (employeeId: string) => employees.find((row: AppShopEmployee) => row.id === employeeId);

  const saveNewEntry = async ({ draft, day }: { draft: NewEntryDraft; day: Date }): Promise<boolean> => {
    const employee = findEmployee(draft.employeeId);
    if (!employee) {
      toast.error('Choose an employee for this time entry.');
      return false;
    }
    if (!draft.clockInTime) {
      toast.error('Clock-in time is required.');
      return false;
    }
    if (!draft.clockOutTime) {
      toast.error('Clock-out time is required for manager-added entries.');
      return false;
    }

    const dayKey = format(day, 'yyyy-MM-dd');
    const existingDayEntries = timeEntries.filter(
      (entry: ShopTimeEntry) => entry.employee?.id === employee.id && entry.clockIn && getEntryWorkDateKey(entry) === dayKey,
    );
    const clockIn = timeOnWorkDay(day, draft.clockInTime, existingDayEntries);
    const clockOut = timeAfter(clockIn, draft.clockOutTime);
    if (new Date(clockOut).getTime() <= new Date(clockIn).getTime()) {
      toast.error('Clock-out must be after clock-in.');
      return false;
    }

    const selectedAsset = resolveDraftAsset(draft, assets);
    const manualDivision = draft.division.trim();
    const manualJobNumber = draft.jobNumber.trim();
    if (manualDivision && !Number.isFinite(Number(manualDivision))) {
      toast.error('Division must be a number.');
      return false;
    }

    const label = selectedAsset
      ? getAssetDisplayName(selectedAsset)
      : manualJobNumber || (manualDivision ? `Division ${manualDivision}` : 'Time entry');
    const { assetDivision, division } = divisionFields(selectedAsset?.divisionCode, manualDivision);
    // Stored hours use the day's scheduled start, matching every pay total.
    let payStart: string | null | undefined;
    try {
      payStart = await fetchPayStart(queryClient, employee.id, employee, dayKey);
    } catch (error: unknown) {
      toast.error(toErrorMessage(error, 'Unable to load the scheduled start.'));
      return false;
    }
    // A manager-added entry inherits the day's existing lunch override so the
    // day's pay total does not change shape when the row lands.
    const notes = applyNoLunchMarker(
      undefined,
      getDayPayMinutes(existingDayEntries, new Date(), payStart, {
        isRoadMech: employee.isRoadMech,
        isAdmin: employee.isAdmin,
        isPartsRunner: employee.isPartsRunner,
      }).noLunch,
    );
    const provisionalEntry: ShopTimeEntry = {
      id: `provisional-${dayKey}-${employee.id}`,
      timeEntry: `${employee.employeeName} - ${label}`,
      employee: { id: employee.id, autoNumber: employee.autoNumber },
      asset: selectedAsset ? { id: selectedAsset.id, asset: getAssetDisplayName(selectedAsset) } : undefined,
      assetDivision: assetDivision ?? undefined,
      division: division ?? undefined,
      clockIn,
      clockOut,
      jobNumber: manualJobNumber || undefined,
      notes,
      workDate: dayKey,
    };
    const hours =
      getEntryPaidMinutes([...existingDayEntries, provisionalEntry], provisionalEntry, new Date(), payStart, {
        isRoadMech: employee.isRoadMech,
        isAdmin: employee.isAdmin,
        isPartsRunner: employee.isPartsRunner,
      }) / 60;

    try {
      await createTimeEntry.mutateAsync({
        timeEntry: provisionalEntry.timeEntry,
        employee: { id: employee.id, autoNumber: employee.autoNumber },
        asset: provisionalEntry.asset,
        assetDivision: provisionalEntry.assetDivision,
        division: provisionalEntry.division,
        jobNumber: manualJobNumber || undefined,
        payTypeKey: draft.payTypeKey,
        clockIn,
        clockOut,
        hours,
        workDate: dayKey,
        notes,
      });
      toast.success(`Time entry added for ${employee.employeeName} on ${format(day, 'MMM d')} — ${formatSpan(clockIn, clockOut)}.`);
      return true;
    } catch (error: unknown) {
      toast.error(toErrorMessage(error, 'Unable to add time entry.'));
      return false;
    }
  };

  const saveEdit = async ({
    entry,
    editValues,
    dayEntries,
  }: {
    entry: ShopTimeEntry;
    editValues: EditableEntry;
    dayEntries: ShopTimeEntry[];
  }): Promise<boolean> => {
    if (!editValues.clockInTime || !entry.clockIn) {
      toast.error('Clock-in time is required.');
      return false;
    }

    if (!editValues.clockOutTime && entry.clockOut) {
      toast.error(`Clock-out can't be blank on a finished entry. Enter the correct time — it was ${format(new Date(entry.clockOut), 'p')}.`);
      return false;
    }

    const employeeName = getEntryEmployeeName(entry, employees);
    const job = isPtoEntry(entry)
      ? undefined
      : buildJobDetails(
          employeeName,
          { asset: resolveDraftAsset(editValues, assets), division: editValues.division, jobNumber: editValues.jobNumber },
          { allowUnassigned: isClockInOnlyRow(entry) || isAwaitingAsset(entry) },
        );
    if (job && 'error' in job) {
      toast.error(job.error);
      return false;
    }
    const clockIn =
      editValues.clockInTime === formatTimeForInput(entry.clockIn) ? entry.clockIn : timeNear(entry.clockIn, editValues.clockInTime);
    const clockOut = !editValues.clockOutTime
      ? undefined
      : entry.clockOut && editValues.clockOutTime === formatTimeForInput(entry.clockOut)
        ? entry.clockOut
        : timeAfter(clockIn, editValues.clockOutTime);
    const clockInOnly = isClockInOnlyRow(entry);
    if (clockOut && clockInOnly && new Date(clockIn).getTime() > new Date(clockOut).getTime()) {
      toast.error(`Clock-in must be at or before ${format(new Date(clockOut), 'p')}, when the first job started.`);
      return false;
    }
    if (clockOut && !clockInOnly && new Date(clockOut).getTime() <= new Date(clockIn).getTime()) {
      toast.error('Clock-out must be after clock-in.');
      return false;
    }
    const label = job ? job.label : getEntryAssetName(entry, assets);
    // The row stays on its shift's work day even when its times now fall after midnight.
    const workDate = entryWorkDateKey(entry) ?? format(new Date(clockIn), 'yyyy-MM-dd');
    const updatedEntry = { ...entry, clockIn, clockOut };
    const employeeDayEntries = dayEntries
      .filter((row: ShopTimeEntry) => getEntryEmployeeKey(row) === getEntryEmployeeKey(entry))
      .map((row: ShopTimeEntry) => (row.id === entry.id ? updatedEntry : row));
    const ptoHours = getPtoHours(entry);
    const employee = employees.find((candidate) => candidate.id === entry.employee?.id);
    const payProfile = {
      isRoadMech: employee?.isRoadMech,
      isAdmin: employee?.isAdmin,
      isPartsRunner: employee?.isPartsRunner,
    };
    // Stored hours use the day's scheduled start, matching every pay total.
    let payStart: string | null | undefined;
    if (clockOut && entry.employee?.id) {
      try {
        payStart = await fetchPayStart(queryClient, entry.employee.id, payProfile, workDate);
      } catch (error: unknown) {
        toast.error(toErrorMessage(error, 'Unable to load the scheduled start.'));
        return false;
      }
    }

    try {
      await updateTimeEntry.mutateAsync({
        id: entry.id,
        changedFields: {
          ...job?.fields,
          // Always sent, even when empty: an omitted field would leave the auto clock-out marker in place.
          notes: applyNoLunchMarker(editValues.notes.trim() || undefined, notesHaveNoLunch(entry.notes)),
          clockIn,
          clockOut,
          payTypeKey: isPtoEntry(entry) ? entry.payTypeKey : editValues.payTypeKey,
          hours: clockOut ? getEntryPaidMinutes(employeeDayEntries, updatedEntry, new Date(), payStart, payProfile) / 60 : undefined,
          pTOTimeKey:
            isPtoEntry(entry) && (ptoHours === 4 || ptoHours === 8) ? PTO_TIME_KEY_BY_HOURS[ptoHours as PtoHours] : entry.pTOTimeKey,
          workDate,
        },
      });
      const day = format(new Date(`${workDate}T12:00:00`), 'MMM d');
      const span = formatSpan(clockIn, clockOut);
      const saved = clockInOnly
        ? `Clock-in for ${employeeName} on ${day} saved — ${format(new Date(clockIn), 'p')}.`
        : `${employeeName} · ${label} saved for ${day} — ${span}.`;
      toast.success(notesHaveAutoClockOut(entry.notes) ? `${saved} Needs review cleared.` : saved);
      return true;
    } catch (error: unknown) {
      toast.error(toErrorMessage(error, 'Unable to update timecard row.'));
      return false;
    }
  };

  const savePto = async ({ draft, day }: { draft: PtoDraft; day: Date }): Promise<boolean> => {
    const employee = findEmployee(draft.employeeId);
    if (!employee) {
      toast.error('Choose an employee for this PTO.');
      return false;
    }
    if (!draft.type) {
      toast.error('Choose a PTO type.');
      return false;
    }

    const clockIn = getPtoClockInIso(day);
    const clockOut = addHours(new Date(clockIn), draft.hours).toISOString();
    const dayKey = format(day, 'yyyy-MM-dd');
    const typeLabel = ShopTimeEntryPTOTypeKeyToLabel[draft.type];

    try {
      await createTimeEntry.mutateAsync({
        timeEntry: `${employee.employeeName} - PTO`,
        pTOTimeKey: PTO_TIME_KEY_BY_HOURS[draft.hours],
        pTOTypeKey: draft.type,
        employee: { id: employee.id, autoNumber: employee.autoNumber },
        jobNumber: 'PTO',
        clockIn,
        clockOut,
        hours: draft.hours,
        workDate: dayKey,
        ptoApproval: 'Approved' as ShopTimeEntryPTOApprovalKey,
        notes: `${draft.hours} hours ${typeLabel} PTO submitted for ${format(day, 'MMM d, yyyy')}.`,
      });
      toast.success(`${draft.hours} hours ${typeLabel} PTO added for ${employee.employeeName} on ${format(day, 'MMM d')}.`);
      return true;
    } catch (error: unknown) {
      toast.error(toErrorMessage(error, 'Unable to add PTO.'));
      return false;
    }
  };

  const deleteEntry = async (entry: ShopTimeEntry): Promise<boolean> => {
    try {
      await deleteTimeEntryMutation.mutateAsync(entry.id);
      const employeeName = getEntryEmployeeName(entry, employees);
      const label = isClockInOnlyRow(entry) ? 'clock-in' : getEntryAssetName(entry, assets);
      const workDate = entryWorkDateKey(entry);
      const day = workDate ? ` on ${format(new Date(`${workDate}T12:00:00`), 'MMM d')}` : '';
      const span = entry.clockIn ? ` (${formatSpan(entry.clockIn, entry.clockOut)})` : '';
      toast.success(`Deleted ${employeeName}'s ${label}${day}${span}.`);
      return true;
    } catch (error: unknown) {
      toast.error(toErrorMessage(error, 'Unable to delete timecard row.'));
      return false;
    }
  };

  return {
    saveNewEntry,
    saveEdit,
    savePto,
    deleteEntry,
    setDayNoLunch,
    lunchUpdatingKey,
    isCreating: createTimeEntry.isPending,
    isUpdating: updateTimeEntry.isPending,
    isDeleting: deleteTimeEntryMutation.isPending,
  };
}
