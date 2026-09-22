import { useMemo, useState } from 'react';
import { addDays, addHours, addWeeks, endOfWeek, format, startOfDay, startOfWeek } from 'date-fns';
import { CalendarIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Download, LockKeyhole, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllEquipmentAssets, useCreateShopTimeEntry, useDeleteShopTimeEntry, useShopEmployeeList, useShopTimeEntryList, useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import { buildPayrollWorkbookBlob } from '@/lib/payroll-workbook';
import { apiFetch } from '@/lib/api';
import {
  applyNoLunchMarker,
  formatDuration,
  getDayPayMinutes,
  getEntryPaidMinutes,
  getPtoHours,
  isPtoEntry,
  lunchCsvLabel,
  stripNoLunchMarker,
} from '@/lib/time-rules';
import { ShopTimeEntryPayTypeKeyToLabel, ShopTimeEntryPTOTypeKeyToLabel, DEFAULT_PAY_TYPE, type ShopTimeEntry, type ShopTimeEntryPayTypeKey, type ShopTimeEntryPTOTimeKey, type ShopTimeEntryPTOTypeKey } from '@/models/shop-time-entry';
import { NoLunchCheckbox } from '@/components/no-lunch-checkbox';
import { useUser } from '@/hooks/use-user';

type PtoHours = 4 | 8;

type EditableEntry = {
  assetId: string;
  assetRecord?: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'>;
  division: string;
  jobNumber: string;
  payTypeKey: ShopTimeEntryPayTypeKey;
  clockInTime: string;
  clockOutTime: string;
};

type NewEntryDraft = EditableEntry & {
  employeeId: string;
};

type PtoDraft = {
  employeeId: string;
  hours: PtoHours;
  type: ShopTimeEntryPTOTypeKey | '';
};

type EmployeeDailySummary = {
  employeeKey: string;
  employeeName: string;
  employeeNumber: string;
  entries: ShopTimeEntry[];
  activeCount: number;
  totalMinutes: number;
  noLunch: boolean;
  lunchDeducted: boolean;
};

type AssetPickerProps = {
  assets: EquipmentAsset[];
  value: string;
  onChange: (asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => void;
  currentAsset?: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'>;
};

const getTodayKey = () => format(new Date(), 'yyyy-MM-dd');
const getWeekRange = (date: Date) => {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const end = endOfWeek(date, { weekStartsOn: 0 });
  return { start, end };
};

const formatWeekRangeLabel = (date: Date) => {
  const { start, end } = getWeekRange(date);
  return `${format(start, 'M/d/yyyy')} - ${format(end, 'M/d/yyyy')}`;
};

const getAssetDisplayName = (asset?: EquipmentAsset | Pick<EquipmentAsset, 'id' | 'asset'> | null) => {
  if (!asset) {
    return 'Unassigned asset';
  }

  return asset.asset || 'Unassigned asset';
};

const getEntryAssetName = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  if (isPtoEntry(entry)) return 'PTO';
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  if (entry.asset?.asset || matchedAsset) {
    return entry.asset?.asset || getAssetDisplayName(matchedAsset);
  }

  return '';
};

const getEntryDivision = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  return String(entry.assetDivision ?? matchedAsset?.divisionCode ?? '');
};

const PTO_TIME_KEY_BY_HOURS: Record<4 | 8, ShopTimeEntryPTOTimeKey> = { 4: 'PTOTimeKey04', 8: 'PTOTimeKey18' };

const formatTimeForInput = (dateTime?: string) => {
  if (!dateTime) {
    return '';
  }

  return format(new Date(dateTime), 'HH:mm');
};

const getEntryJobNumber = (entry: ShopTimeEntry) => entry.jobNumber ?? '';

const getEntryEmployeeKey = (entry: ShopTimeEntry) => entry.employee?.id ?? entry.id;

const getEntryEmployeeName = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return employeeRecord?.employeeName ?? entry.employee?.autoNumber ?? 'Unknown employee';
};

const getEntryEmployeeNumber = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return String(employeeRecord?.employeeCode ?? entry.employee?.autoNumber ?? '—');
};

const mergeDateAndTime = (existingDateTime: string, timeValue: string) => {
  const date = new Date(existingDateTime);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

const combineSelectedDateAndTime = (day: Date, timeValue: string) => {
  const date = startOfDay(day);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

const getPtoClockInIso = (date: Date) => {
  const ptoDate = startOfDay(date);
  ptoDate.setHours(8, 0, 0, 0);
  return ptoDate.toISOString();
};

const emptyEntryDraft = (employeeId = ''): NewEntryDraft => ({
  employeeId,
  assetId: '',
  assetRecord: undefined,
  division: '',
  jobNumber: '',
  payTypeKey: DEFAULT_PAY_TYPE,
  clockInTime: '',
  clockOutTime: '',
});

const emptyPtoDraft = (employeeId = ''): PtoDraft => ({
  employeeId,
  hours: 8,
  type: '',
});

const getEntryWorkDateKey = (entry: ShopTimeEntry) => (entry.clockIn ? format(new Date(entry.clockIn), 'yyyy-MM-dd') : 'No clock-in date');

const getEmployeeNotes = (notes?: string) => stripNoLunchMarker(notes);

function AssetPicker({ assets, value, onChange, currentAsset }: AssetPickerProps) {
  const [search, setSearch] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const trimmedSearch = search.trim();
  const allAssets = useMemo(() => {
    const assetsById = new Map<string, EquipmentAsset>();
    [...assets, ...(currentAsset ? [currentAsset as EquipmentAsset] : [])].forEach((asset: EquipmentAsset) => {
      if (asset.id) {
        assetsById.set(asset.id, asset);
      }
    });
    return Array.from(assetsById.values()).sort((assetA: EquipmentAsset, assetB: EquipmentAsset) =>
      getAssetDisplayName(assetA).localeCompare(getAssetDisplayName(assetB), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [assets, currentAsset]);
  const selectedAsset = allAssets.find((asset: EquipmentAsset) => asset.id === value);
  const inputValue = search || (selectedAsset ? getAssetDisplayName(selectedAsset) : '');
  const validAssets = allAssets.filter((asset: EquipmentAsset) => asset.id);
  const filteredAssets = validAssets.filter((asset: EquipmentAsset) => getAssetDisplayName(asset).toLowerCase().includes(trimmedSearch.toLowerCase()));
  const assetToSelect = filteredAssets.find((asset: EquipmentAsset) => getAssetDisplayName(asset).toLowerCase() === trimmedSearch.toLowerCase()) ?? filteredAssets[0];
  const handleSelect = (assetId: string) => {
    const selected = allAssets.find((asset: EquipmentAsset) => asset.id === assetId);
    onChange(selected ? { id: selected.id, asset: getAssetDisplayName(selected), divisionCode: selected.divisionCode } : undefined);
    setSearch(selected ? getAssetDisplayName(selected) : '');
    setIsOpen(false);
  };
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setIsOpen(true);
    if (value) {
      onChange(undefined);
    }
  };

  return (
    <div className="relative">
      <Input className={`bg-background pr-10 ${value ? 'font-semibold' : ''}`} value={inputValue} onChange={handleSearchChange} onFocus={() => setIsOpen(true)} onBlur={() => window.setTimeout(() => setIsOpen(false), 150)} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && assetToSelect?.id) { event.preventDefault(); handleSelect(assetToSelect.id); } }} placeholder="Search assets" />
      <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
      {isOpen ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {filteredAssets.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No asset matches “{inputValue}”.</p> : null}
          {filteredAssets.map((asset: EquipmentAsset) => (
            <button key={asset.id} type="button" className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted focus:bg-muted focus:outline-none ${value === asset.id ? 'font-semibold' : ''}`} onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()} onClick={() => handleSelect(asset.id)}>
              <Check className={`h-4 w-4 ${value === asset.id ? '' : 'invisible'}`} />
              <span>{getAssetDisplayName(asset)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ManagerDashboardPage() {
  const [search, setSearch] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [exportWeekDate, setExportWeekDate] = useState<Date>(startOfDay(new Date()));
  const [isExporting, setIsExporting] = useState(false);
  const [openEmployeeKeys, setOpenEmployeeKeys] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string>('');
  const [editValues, setEditValues] = useState<EditableEntry | null>(null);
  const [addingForEmployeeKey, setAddingForEmployeeKey] = useState<string>('');
  const [newEntryDraft, setNewEntryDraft] = useState<NewEntryDraft | null>(null);
  const [showMissedEntryForm, setShowMissedEntryForm] = useState(false);
  const [missedEmployeeSearch, setMissedEmployeeSearch] = useState('');
  const [showPtoForm, setShowPtoForm] = useState(false);
  const [ptoDraft, setPtoDraft] = useState<PtoDraft | null>(null);
  const [ptoEmployeeSearch, setPtoEmployeeSearch] = useState('');
  const [lunchUpdatingKey, setLunchUpdatingKey] = useState('');
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useUser();
  const { data: shopEmployees = [], isLoading: employeesLoading } = useShopEmployeeList();
  const employees = useMemo(() => mapShopEmployees(shopEmployees), [shopEmployees]);
  const { data: assets = [], isLoading: assetsLoading, refetch: refetchAssets } = useAllEquipmentAssets();
  const { data: timeEntries = [], isLoading: entriesLoading, refetch: refetchEntries } = useShopTimeEntryList();
  const isAllowedManager = Boolean(user?.isManager);
  const createTimeEntry = useCreateShopTimeEntry();
  const deleteTimeEntry = useDeleteShopTimeEntry();
  const updateTimeEntry = useUpdateShopTimeEntry();

  const selectedDayEntries = useMemo(() => {
    const selectedDay = format(selectedDate, 'yyyy-MM-dd');
    return timeEntries
      .filter((entry: ShopTimeEntry) => entry.clockIn?.startsWith(selectedDay))
      .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(b.clockIn ?? '').getTime() - new Date(a.clockIn ?? '').getTime());
  }, [selectedDate, timeEntries]);

  const employeeSummaries = useMemo(() => {
    const summaries = new Map<string, EmployeeDailySummary>();

    selectedDayEntries.forEach((entry: ShopTimeEntry) => {
      const employeeKey = getEntryEmployeeKey(entry);
      const current = summaries.get(employeeKey) ?? {
        employeeKey,
        employeeName: getEntryEmployeeName(entry, employees),
        employeeNumber: getEntryEmployeeNumber(entry, employees),
        entries: [] as ShopTimeEntry[],
        activeCount: 0,
        totalMinutes: 0,
        noLunch: false,
        lunchDeducted: false,
      };

      current.entries.push(entry);
      current.activeCount += entry.clockOut ? 0 : 1;
      summaries.set(employeeKey, current);
    });

    return Array.from(summaries.values())
      .map((summary: EmployeeDailySummary) => {
        const pay = getDayPayMinutes(summary.entries);
        return {
          ...summary,
          totalMinutes: pay.totalMinutes,
          noLunch: pay.noLunch,
          lunchDeducted: pay.lunchDeducted,
        };
      })
      .filter((summary: EmployeeDailySummary) => {
        const query = search.trim().toLowerCase();
        return !query || summary.employeeName.toLowerCase().includes(query) || summary.employeeNumber.toLowerCase().includes(query);
      })
      .sort((a: EmployeeDailySummary, b: EmployeeDailySummary) => a.employeeName.localeCompare(b.employeeName));
  }, [employees, search, selectedDayEntries]);

  const exportWeekRange = useMemo(() => getWeekRange(exportWeekDate), [exportWeekDate]);

  const weeklyEntries = useMemo(() => {
    return timeEntries
      .filter((entry: ShopTimeEntry) => {
        const clockInDate = entry.clockIn ? new Date(entry.clockIn) : null;
        return clockInDate ? clockInDate >= exportWeekRange.start && clockInDate <= exportWeekRange.end : false;
      })
      .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
  }, [exportWeekRange, timeEntries]);

  const weeklyPayrollMinutes = useMemo(() => {
    const groups = new Map<string, ShopTimeEntry[]>();
    weeklyEntries.forEach((entry: ShopTimeEntry) => {
      const key = `${getEntryEmployeeKey(entry)}|${getEntryWorkDateKey(entry)}`;
      const current = groups.get(key) ?? [];
      current.push(entry);
      groups.set(key, current);
    });
    return [...groups.values()].reduce((total: number, dayEntries: ShopTimeEntry[]) => total + getDayPayMinutes(dayEntries).totalMinutes, 0);
  }, [weeklyEntries]);


  const handleToggleEmployee = (employeeKey: string) => {
    setOpenEmployeeKeys((currentKeys: string[]) =>
      currentKeys.includes(employeeKey) ? currentKeys.filter((key: string) => key !== employeeKey) : [...currentKeys, employeeKey],
    );
  };
  const activeEmployeeCount = employeeSummaries.filter((summary: EmployeeDailySummary) => summary.activeCount > 0).length;
  const totalHours = formatDuration(employeeSummaries.reduce((total: number, summary: EmployeeDailySummary) => total + summary.totalMinutes, 0));

  const handleStartEdit = (entry: ShopTimeEntry) => {
    handleCancelAddEntry();
    handleCancelPto();
    setEditingEntryId(entry.id);
    setEditValues({
      assetId: entry.asset?.id ?? '',
      assetRecord: entry.asset,
      division: String(entry.assetDivision ?? ''),
      jobNumber: getEntryJobNumber(entry),
      payTypeKey: entry.payTypeKey ?? DEFAULT_PAY_TYPE,
      clockInTime: formatTimeForInput(entry.clockIn),
      clockOutTime: formatTimeForInput(entry.clockOut),
    });
  };

  const handleCancelEdit = () => {
    setEditingEntryId('');
    setEditValues(null);
  };

  const handleCancelAddEntry = () => {
    setAddingForEmployeeKey('');
    setNewEntryDraft(null);
    setShowMissedEntryForm(false);
    setMissedEmployeeSearch('');
  };

  const handleCancelPto = () => {
    setShowPtoForm(false);
    setPtoDraft(null);
    setPtoEmployeeSearch('');
  };

  const handleStartAddEntry = (summary: EmployeeDailySummary) => {
    handleCancelEdit();
    handleCancelPto();
    setShowMissedEntryForm(false);
    setMissedEmployeeSearch('');
    setAddingForEmployeeKey(summary.employeeKey);
    setNewEntryDraft(emptyEntryDraft(summary.employeeKey));
    setOpenEmployeeKeys((currentKeys: string[]) =>
      currentKeys.includes(summary.employeeKey) ? currentKeys : [...currentKeys, summary.employeeKey],
    );
  };

  const handleStartMissedEntry = () => {
    handleCancelEdit();
    handleCancelPto();
    setAddingForEmployeeKey('');
    setShowMissedEntryForm(true);
    setNewEntryDraft(emptyEntryDraft());
  };

  const handleStartAddPto = (employeeId = '') => {
    handleCancelEdit();
    handleCancelAddEntry();
    setShowPtoForm(true);
    setPtoDraft(emptyPtoDraft(employeeId));
    setPtoEmployeeSearch(employees.find((row: AppShopEmployee) => row.id === employeeId)?.employeeName ?? '');
    if (employeeId) {
      setOpenEmployeeKeys((currentKeys: string[]) =>
        currentKeys.includes(employeeId) ? currentKeys : [...currentKeys, employeeId],
      );
    }
  };

  const handleSavePto = async () => {
    if (!ptoDraft) return;
    const employee = employees.find((row: AppShopEmployee) => row.id === ptoDraft.employeeId);
    if (!employee) {
      toast.error('Choose an employee for this PTO.');
      return;
    }
    if (!ptoDraft.type) {
      toast.error('Choose a PTO type.');
      return;
    }

    const clockIn = getPtoClockInIso(selectedDate);
    const clockOut = addHours(new Date(clockIn), ptoDraft.hours).toISOString();
    const dayKey = format(selectedDate, 'yyyy-MM-dd');
    const typeLabel = ShopTimeEntryPTOTypeKeyToLabel[ptoDraft.type];

    try {
      await createTimeEntry.mutateAsync({
        timeEntry: `${employee.employeeName} - PTO`,
        pTOTimeKey: PTO_TIME_KEY_BY_HOURS[ptoDraft.hours],
        pTOTypeKey: ptoDraft.type,
        employee: { id: employee.id, autoNumber: employee.autoNumber },
        jobNumber: 'PTO',
        clockIn,
        clockOut,
        hours: ptoDraft.hours,
        workDate: dayKey,
        notes: `${ptoDraft.hours} hours ${typeLabel} PTO submitted for ${format(selectedDate, 'MMM d, yyyy')}.`,
      });
      handleCancelPto();
      setOpenEmployeeKeys((currentKeys: string[]) =>
        currentKeys.includes(employee.id) ? currentKeys : [...currentKeys, employee.id],
      );
      toast.success(`${ptoDraft.hours} hours ${typeLabel} PTO added for ${employee.employeeName} on ${format(selectedDate, 'MMM d')}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to add PTO.');
    }
  };

  const handleSaveNewEntry = async () => {
    if (!newEntryDraft) {
      return;
    }

    const employee = employees.find((row: AppShopEmployee) => row.id === newEntryDraft.employeeId);
    if (!employee) {
      toast.error('Choose an employee for this time entry.');
      return;
    }
    if (!newEntryDraft.clockInTime) {
      toast.error('Clock-in time is required.');
      return;
    }
    if (!newEntryDraft.clockOutTime) {
      toast.error('Clock-out time is required for manager-added entries.');
      return;
    }

    const clockIn = combineSelectedDateAndTime(selectedDate, newEntryDraft.clockInTime);
    const clockOut = combineSelectedDateAndTime(selectedDate, newEntryDraft.clockOutTime);
    if (new Date(clockOut).getTime() <= new Date(clockIn).getTime()) {
      toast.error('Clock-out must be after clock-in.');
      return;
    }

    const selectedAsset = newEntryDraft.assetId
      ? newEntryDraft.assetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === newEntryDraft.assetId)
      : undefined;
    const manualDivision = newEntryDraft.division.trim();
    const manualJobNumber = newEntryDraft.jobNumber.trim();
    if (manualDivision && !Number.isFinite(Number(manualDivision))) {
      toast.error('Division must be a number.');
      return;
    }
    const label = selectedAsset
      ? getAssetDisplayName(selectedAsset)
      : manualJobNumber || (manualDivision ? `Division ${manualDivision}` : 'Time entry');
    const dayKey = format(selectedDate, 'yyyy-MM-dd');
    const existingDayEntries = timeEntries.filter(
      (entry: ShopTimeEntry) => entry.employee?.id === employee.id && entry.clockIn?.startsWith(dayKey),
    );
    const dayAlreadyNoLunch = getDayPayMinutes(existingDayEntries).noLunch;
    const provisionalId = `new-${Date.now()}`;
    const provisionalEntry: ShopTimeEntry = {
      id: provisionalId,
      timeEntry: `${employee.employeeName} - ${label}`,
      employee: { id: employee.id, autoNumber: employee.autoNumber },
      asset: selectedAsset ? { id: selectedAsset.id, asset: getAssetDisplayName(selectedAsset) } : undefined,
      assetDivision: selectedAsset ? selectedAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
      clockIn,
      clockOut,
      jobNumber: manualJobNumber || undefined,
      notes: applyNoLunchMarker(undefined, dayAlreadyNoLunch),
      workDate: dayKey,
    };
    const dayEntriesForPay = [...existingDayEntries, provisionalEntry];
    const hours = getEntryPaidMinutes(dayEntriesForPay, provisionalEntry) / 60;

    try {
      await createTimeEntry.mutateAsync({
        timeEntry: provisionalEntry.timeEntry,
        employee: { id: employee.id, autoNumber: employee.autoNumber },
        asset: selectedAsset ? { id: selectedAsset.id, asset: getAssetDisplayName(selectedAsset) } : undefined,
        assetDivision: selectedAsset ? selectedAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
        division: selectedAsset ? selectedAsset.divisionCode : manualDivision ? Number(manualDivision) : undefined,
        jobNumber: manualJobNumber || undefined,
        payTypeKey: newEntryDraft.payTypeKey,
        clockIn,
        clockOut,
        hours,
        workDate: dayKey,
        notes: applyNoLunchMarker(undefined, dayAlreadyNoLunch),
      });
      handleCancelAddEntry();
      setOpenEmployeeKeys((currentKeys: string[]) =>
        currentKeys.includes(employee.id) ? currentKeys : [...currentKeys, employee.id],
      );
      toast.success(`Time entry added for ${employee.employeeName}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to add time entry.');
    }
  };

  const handleSaveEdit = async (entry: ShopTimeEntry) => {
    if (!editValues) {
      return;
    }

    const selectedAsset = editValues.assetId ? editValues.assetRecord ?? assets.find((asset: EquipmentAsset) => asset.id === editValues.assetId) : undefined;
    const manualDivision = editValues.division.trim();
    const manualJobNumber = editValues.jobNumber.trim();

    if (!editValues.clockInTime || !entry.clockIn) {
      toast.error('Clock-in time is required.');
      return;
    }

    const clockIn = mergeDateAndTime(entry.clockIn, editValues.clockInTime);
    const clockOut = editValues.clockOutTime ? mergeDateAndTime(entry.clockIn, editValues.clockOutTime) : undefined;
    const label = selectedAsset ? getAssetDisplayName(selectedAsset) : manualJobNumber || (manualDivision ? `Division ${manualDivision}` : getEntryAssetName(entry, assets) || 'Time entry');
    const notes = entry.notes ?? '';
    const updatedEntry = { ...entry, clockIn, clockOut };
    const dayEntries = selectedDayEntries
      .filter((row: ShopTimeEntry) => getEntryEmployeeKey(row) === getEntryEmployeeKey(entry))
      .map((row: ShopTimeEntry) => (row.id === entry.id ? updatedEntry : row));

    try {
      await updateTimeEntry.mutateAsync({
        id: entry.id,
        changedFields: {
          timeEntry: `${getEntryEmployeeName(entry, employees)} - ${label}`,
          asset: selectedAsset ? { id: selectedAsset.id, asset: getAssetDisplayName(selectedAsset) } : entry.asset,
          assetDivision: selectedAsset ? selectedAsset.divisionCode : manualDivision ? Number(manualDivision) : entry.assetDivision,
          notes: notes || undefined,
          clockIn,
          clockOut,
          division: !selectedAsset && manualDivision ? Number(manualDivision) : undefined,
          jobNumber: manualJobNumber || undefined,
          payTypeKey: isPtoEntry(entry) ? entry.payTypeKey : editValues.payTypeKey,
          hours: clockOut ? getEntryPaidMinutes(dayEntries, updatedEntry) / 60 : undefined,
          pTOTimeKey: isPtoEntry(entry) && (getPtoHours(entry) === 4 || getPtoHours(entry) === 8) ? PTO_TIME_KEY_BY_HOURS[getPtoHours(entry) as 4 | 8] : entry.pTOTimeKey,
          workDate: format(new Date(clockIn), 'yyyy-MM-dd'),
        },
      });
      handleCancelEdit();
      toast.success('Timecard row updated.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update timecard row.');
    }
  };

  const handleDeleteEntry = async (entry: ShopTimeEntry) => {
    try {
      await deleteTimeEntry.mutateAsync(entry.id);
      if (editingEntryId === entry.id) {
        handleCancelEdit();
      }
      toast.success('Timecard row deleted.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete timecard row.');
    }
  };

  const handleReloadTables = async () => {
    try {
      await Promise.all([refetchAssets(), refetchEntries()]);
      toast.success('Equipment assets and shop time entries reloaded.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to reload table data.');
    }
  };

  const handleNoLunchChange = async (summary: EmployeeDailySummary, checked: boolean) => {
    const laborEntries = summary.entries.filter((entry: ShopTimeEntry) => !isPtoEntry(entry));
    if (laborEntries.length === 0) {
      toast.info('Clock time for this employee first, then lunch can be overridden.');
      return;
    }

    const entryIds = new Set(laborEntries.map((entry: ShopTimeEntry) => entry.id));
    const previousEntries = queryClient.getQueryData<ShopTimeEntry[]>(['shopTimeEntry-list']);

    // Flip the checkbox immediately from cached notes, then persist.
    queryClient.setQueryData<ShopTimeEntry[]>(['shopTimeEntry-list'], (current) =>
      (current ?? []).map((entry: ShopTimeEntry) =>
        entryIds.has(entry.id)
          ? { ...entry, notes: applyNoLunchMarker(entry.notes, checked) }
          : entry,
      ),
    );

    setLunchUpdatingKey(summary.employeeKey);
    try {
      for (const entry of laborEntries) {
        const nextNotes = applyNoLunchMarker(entry.notes, checked);
        await apiFetch<ShopTimeEntry>(`/api/time-entries/${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: nextNotes }),
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['shopTimeEntry-list'] });
      toast.success(checked ? `No lunch saved for ${summary.employeeName}.` : `Lunch deduction restored for ${summary.employeeName}.`);
    } catch (error: unknown) {
      if (previousEntries) {
        queryClient.setQueryData(['shopTimeEntry-list'], previousEntries);
      } else {
        await queryClient.invalidateQueries({ queryKey: ['shopTimeEntry-list'] });
      }
      toast.error(error instanceof Error ? error.message : 'Unable to update lunch setting.');
    } finally {
      setLunchUpdatingKey('');
    }
  };

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

  if (userLoading || !user) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl"><LockKeyhole className="h-6 w-6" /> Checking manager access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading your Microsoft 365 identity before opening the manager dashboard.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!isAllowedManager) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Card className="border-l-4 border-l-destructive bg-card text-card-foreground shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl"><LockKeyhole className="h-6 w-6" /> Manager access required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Your Microsoft 365 account is not currently on the manager allowlist for this dashboard.</p>
            <div className="rounded-lg bg-muted p-4 text-muted-foreground">
              <p className="text-sm">Signed in as</p>
              <p className="mt-1 font-semibold text-foreground">{user.name || 'Unknown user'}</p>
              <p className="text-sm">{user.email}</p>
            </div>
            <p className="text-sm text-muted-foreground">Ask the app owner to add this email to the <span className="font-medium text-foreground">MANAGER_EMAILS</span> Function App setting.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">


      <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl"><ShieldCheck className="h-6 w-6" /> Manager dashboard</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">Access verified with Microsoft 365. Review daily activity and export a weekly Excel workbook.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => void handleReloadTables()} disabled={assetsLoading || entriesLoading}><RefreshCw className="mr-2 h-4 w-4" /> Reload tables</Button><Badge variant="secondary">{user?.name || user?.email || 'Shop manager'}</Badge></div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-muted p-4 text-muted-foreground">
            <p className="text-sm">Employees clocked in</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{employeeSummaries.length}</p>
          </div>
          <div className="rounded-lg bg-muted p-4 text-muted-foreground">
            <p className="text-sm">Currently active</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{activeEmployeeCount}</p>
          </div>
          <div className="rounded-lg bg-muted p-4 text-muted-foreground">
            <p className="text-sm">Total shop time</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{totalHours}</p>
          </div>
          <div className="rounded-lg bg-muted p-4 text-muted-foreground">
            <p className="text-sm">Export week</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{formatDuration(weeklyPayrollMinutes)}</p>
            <p className="mt-1 text-sm">{formatWeekRangeLabel(exportWeekDate)}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl"><Download className="h-5 w-5" /> Weekly timecard export</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Choose a Sunday-Saturday payroll week, then export one Excel workbook: a shop summary plus a detail sheet for each employee.</p>
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
              <Button type="button" variant="ghost" size="icon" aria-label="Previous export week" onClick={() => setExportWeekDate((currentDate: Date) => addWeeks(currentDate, -1))}>
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
                        setExportWeekDate(startOfDay(date));
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button type="button" variant="ghost" size="icon" aria-label="Next export week" onClick={() => setExportWeekDate((currentDate: Date) => addWeeks(currentDate, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl"><Users className="h-5 w-5" /> Employee timecards</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{format(selectedDate, 'EEEE, MMM d')} · edit times, add missed punches or PTO, or mark No lunch.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                    onSelect={(date: Date | undefined) => {
                      if (date) {
                        setSelectedDate(startOfDay(date));
                        setOpenEmployeeKeys([]);
                        handleCancelEdit();
                        handleCancelAddEntry();
                        handleCancelPto();
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input value={search} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} className="pl-9" placeholder="Search employee" />
              </div>
              <Button type="button" variant="secondary" onClick={handleStartMissedEntry} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" /> Add missed entry
              </Button>
              <Button type="button" variant="secondary" onClick={() => handleStartAddPto()} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" /> Add PTO
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {employeesLoading || entriesLoading || assetsLoading ? <p className="text-sm text-muted-foreground">Loading manager dashboard...</p> : null}
          {showPtoForm && ptoDraft ? (
            <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">Add PTO</p>
                  <p className="text-sm">4 or 8 hours of paid time off for {format(selectedDate, 'EEEE, MMM d')}.</p>
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label="Cancel PTO" onClick={handleCancelPto}><X className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pto-employee-search">Employee</Label>
                <Input
                  id="pto-employee-search"
                  className="bg-background"
                  value={ptoEmployeeSearch || (employees.find((row: AppShopEmployee) => row.id === ptoDraft.employeeId)?.employeeName ?? '')}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setPtoEmployeeSearch(event.target.value);
                    setPtoDraft({ ...ptoDraft, employeeId: '' });
                  }}
                  placeholder="Search shop employees"
                />
                {!ptoDraft.employeeId ? (
                  <div className="max-h-40 overflow-auto rounded-md border border-border bg-background">
                    {employees
                      .filter((row: AppShopEmployee) => {
                        const query = ptoEmployeeSearch.trim().toLowerCase();
                        return !query || row.employeeName.toLowerCase().includes(query) || String(row.employeeCode).includes(query);
                      })
                      .slice(0, 12)
                      .map((row: AppShopEmployee) => (
                        <button
                          key={row.id}
                          type="button"
                          className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                          onClick={() => {
                            setPtoDraft({ ...ptoDraft, employeeId: row.id });
                            setPtoEmployeeSearch(row.employeeName);
                          }}
                        >
                          <span className="font-medium text-foreground">{row.employeeName}</span>
                          <span className="text-muted-foreground">{row.employeeCode}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="manager-pto-type">PTO type</Label>
                  <Select value={ptoDraft.type || undefined} onValueChange={(value: ShopTimeEntryPTOTypeKey) => setPtoDraft({ ...ptoDraft, type: value })}>
                    <SelectTrigger id="manager-pto-type" className="w-full bg-background">
                      <SelectValue placeholder="Select PTO type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ShopTimeEntryPTOTypeKeyToLabel).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>PTO hours</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={ptoDraft.hours === 4 ? 'default' : 'outline'} onClick={() => setPtoDraft({ ...ptoDraft, hours: 4 })}>4 hours</Button>
                    <Button type="button" variant={ptoDraft.hours === 8 ? 'default' : 'outline'} onClick={() => setPtoDraft({ ...ptoDraft, hours: 8 })}>8 hours</Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void handleSavePto()} disabled={createTimeEntry.isPending}>Save PTO</Button>
                <Button type="button" variant="outline" onClick={handleCancelPto}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {showMissedEntryForm && newEntryDraft ? (
            <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">Add missed time entry</p>
                  <p className="text-sm">For an employee with no punches yet on {format(selectedDate, 'MMM d')}, or anyone who forgot an asset.</p>
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label="Cancel missed entry" onClick={handleCancelAddEntry}><X className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="missed-employee-search">Employee</Label>
                <Input
                  id="missed-employee-search"
                  className="bg-background"
                  value={missedEmployeeSearch || (employees.find((row: AppShopEmployee) => row.id === newEntryDraft.employeeId)?.employeeName ?? '')}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setMissedEmployeeSearch(event.target.value);
                    setNewEntryDraft({ ...newEntryDraft, employeeId: '' });
                  }}
                  placeholder="Search shop employees"
                />
                {!newEntryDraft.employeeId ? (
                  <div className="max-h-40 overflow-auto rounded-md border border-border bg-background">
                    {employees
                      .filter((row: AppShopEmployee) => {
                        const query = missedEmployeeSearch.trim().toLowerCase();
                        return !query || row.employeeName.toLowerCase().includes(query) || String(row.employeeCode).includes(query);
                      })
                      .slice(0, 12)
                      .map((row: AppShopEmployee) => (
                        <button
                          key={row.id}
                          type="button"
                          className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                          onClick={() => {
                            setNewEntryDraft({ ...newEntryDraft, employeeId: row.id });
                            setMissedEmployeeSearch(row.employeeName);
                          }}
                        >
                          <span className="font-medium text-foreground">{row.employeeName}</span>
                          <span className="text-muted-foreground">{row.employeeCode}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Equipment asset</Label>
                <AssetPicker
                  assets={assets}
                  value={newEntryDraft.assetId}
                  onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) =>
                    setNewEntryDraft({
                      ...newEntryDraft,
                      assetId: asset?.id ?? '',
                      assetRecord: asset,
                      division: asset?.divisionCode !== undefined ? String(asset.divisionCode) : newEntryDraft.division,
                    })
                  }
                  currentAsset={newEntryDraft.assetRecord}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="missed-division">Division</Label>
                  <Input id="missed-division" className="bg-background" value={newEntryDraft.division} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, division: event.target.value.replace(/\D/g, '') })} placeholder="Optional division code" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="missed-job">Job number</Label>
                  <Input id="missed-job" className="bg-background" value={newEntryDraft.jobNumber} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, jobNumber: event.target.value })} placeholder="Optional job note" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="missed-pay-type">Pay type</Label>
                <Select value={newEntryDraft.payTypeKey} onValueChange={(value: ShopTimeEntryPayTypeKey) => setNewEntryDraft({ ...newEntryDraft, payTypeKey: value })}>
                  <SelectTrigger id="missed-pay-type" className="w-full bg-background">
                    <SelectValue placeholder="Select pay type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="missed-clock-in">Clock in</Label>
                  <Input id="missed-clock-in" className="bg-background" type="time" value={newEntryDraft.clockInTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, clockInTime: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="missed-clock-out">Clock out</Label>
                  <Input id="missed-clock-out" className="bg-background" type="time" value={newEntryDraft.clockOutTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, clockOutTime: event.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void handleSaveNewEntry()} disabled={createTimeEntry.isPending}>Save time entry</Button>
                <Button type="button" variant="outline" onClick={handleCancelAddEntry}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {!entriesLoading && employeeSummaries.length === 0 && !showMissedEntryForm && !showPtoForm ? <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No employees have timecard entries for the selected day. Use Add missed entry or Add PTO if needed.</p> : null}
          {employeeSummaries.map((summary: EmployeeDailySummary) => {
            const isOpen = openEmployeeKeys.includes(summary.employeeKey);
            return (
              <Collapsible key={summary.employeeKey} open={isOpen} onOpenChange={() => handleToggleEmployee(summary.employeeKey)} asChild>
                <section className="rounded-lg border border-border bg-background">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">{summary.employeeName}</h2>
                        <p className="text-sm text-muted-foreground">Employee {summary.employeeNumber} · {summary.entries.length} entries · {formatDuration(summary.totalMinutes)}{summary.noLunch ? ' · No lunch' : summary.lunchDeducted ? ' · Lunch 0.5h' : ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={summary.activeCount > 0 ? 'default' : 'outline'}>{summary.activeCount > 0 ? 'Active now' : 'Complete'}</Badge>
                        {summary.noLunch ? <Badge variant="secondary">No lunch</Badge> : null}
                        <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <div className="border-t border-border px-4 py-3">
                    <NoLunchCheckbox checked={summary.noLunch} disabled={lunchUpdatingKey === summary.employeeKey} onCheckedChange={(checked: boolean) => void handleNoLunchChange(summary, checked)} />
                  </div>
                  <CollapsibleContent>
                    <div className="space-y-3 border-t border-border p-4">
                      {summary.entries.map((entry: ShopTimeEntry) => {
                        const isEditing = editingEntryId === entry.id;
                        return (
                          <div key={entry.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-start">
                              <div className="space-y-2">
                                <p className="text-sm text-muted-foreground">Asset / job</p>
                                {isEditing && editValues ? (
                                  <div className="space-y-3">
                                    <AssetPicker assets={assets} value={editValues.assetId} onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => setEditValues({ ...editValues, assetId: asset?.id ?? '', assetRecord: asset, division: asset?.divisionCode ? String(asset.divisionCode) : editValues.division })} currentAsset={editValues.assetRecord ?? entry.asset} />
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div className="space-y-2">
                                        <Label htmlFor={`division-${entry.id}`}>Division</Label>
                                        <Input id={`division-${entry.id}`} value={editValues.division} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditValues({ ...editValues, division: event.target.value.replace(/\D/g, '') })} placeholder="Optional division code" />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`job-number-${entry.id}`}>Job Number</Label>
                                        <Input id={`job-number-${entry.id}`} value={editValues.jobNumber} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditValues({ ...editValues, jobNumber: event.target.value })} placeholder="Optional job note" />
                                      </div>
                                    </div>
                                    {!isPtoEntry(entry) ? (
                                      <div className="space-y-2">
                                        <Label htmlFor={`pay-type-${entry.id}`}>Pay type</Label>
                                        <Select value={editValues.payTypeKey} onValueChange={(value: ShopTimeEntryPayTypeKey) => setEditValues({ ...editValues, payTypeKey: value })}>
                                          <SelectTrigger id={`pay-type-${entry.id}`} className="w-full bg-background">
                                            <SelectValue placeholder="Select pay type" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                              <SelectItem key={key} value={key}>{label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2"><p className="text-base font-semibold">{getEntryAssetName(entry, assets)}</p>{entry.pTOTypeKey ? <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge> : null}{!isPtoEntry(entry) ? <Badge variant="outline">{ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey ?? DEFAULT_PAY_TYPE]}</Badge> : null}</div>
                                    <p className="mt-1 text-sm text-muted-foreground">{isPtoEntry(entry) ? `${getPtoHours(entry)} hours PTO` : `Division ${getEntryDivision(entry, assets) || '—'} · Job ${getEntryJobNumber(entry) || '—'}`}</p>
                                  </div>
                                )}
                              </div>

                              <div className="grid gap-3 sm:grid-cols-3">
                                <div className="space-y-2">
                                  <Label htmlFor={`clock-in-${entry.id}`}>Clock in</Label>
                                  {isEditing && editValues ? (
                                    <Input id={`clock-in-${entry.id}`} type="time" value={editValues.clockInTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditValues({ ...editValues, clockInTime: event.target.value })} />
                                  ) : (
                                    <p className="font-semibold">{entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'}</p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`clock-out-${entry.id}`}>Clock out</Label>
                                  {isEditing && editValues ? (
                                    <Input id={`clock-out-${entry.id}`} type="time" value={editValues.clockOutTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditValues({ ...editValues, clockOutTime: event.target.value })} />
                                  ) : (
                                    <p className="font-semibold">{entry.clockOut ? format(new Date(entry.clockOut), 'p') : 'Active'}</p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  <Label>Duration</Label>
                                  <p className="font-semibold">{formatDuration(getEntryPaidMinutes(summary.entries, entry))}</p>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 lg:justify-end">
                                <Badge variant={entry.clockOut ? 'outline' : 'default'}>{entry.clockOut ? 'Complete' : 'Active'}</Badge>
                                {isEditing ? (
                                  <>
                                    <Button type="button" size="icon" aria-label="Save row" onClick={() => void handleSaveEdit(entry)} disabled={updateTimeEntry.isPending}><Check className="h-4 w-4" /></Button>
                                    <Button type="button" size="icon" variant="outline" aria-label="Cancel row edit" onClick={handleCancelEdit}><X className="h-4 w-4" /></Button>
                                  </>
                                ) : (
                                  <Button type="button" variant="outline" size="sm" onClick={() => handleStartEdit(entry)}><Pencil className="mr-2 h-4 w-4" /> Edit</Button>
                                )}
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button type="button" variant="destructive" size="sm" disabled={deleteTimeEntry.isPending}>
                                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This removes {summary.employeeName}&apos;s {format(selectedDate, 'MMM d')} time entry for {getEntryAssetName(entry, assets)} from Dataverse and the weekly timecard export.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => void handleDeleteEntry(entry)}>Delete time entry</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>
                            {getEmployeeNotes(entry.notes) ? <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">{getEmployeeNotes(entry.notes)}</p> : null}
                          </div>
                        );
                      })}
                      {addingForEmployeeKey === summary.employeeKey && newEntryDraft ? (
                        <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">Add time entry</p>
                              <p className="text-sm">Split a forgotten multi-asset day by adding another punch for {summary.employeeName}.</p>
                            </div>
                            <Button type="button" size="icon" variant="ghost" aria-label="Cancel add entry" onClick={handleCancelAddEntry}><X className="h-4 w-4" /></Button>
                          </div>
                          <div className="space-y-2">
                            <Label>Equipment asset</Label>
                            <AssetPicker
                              assets={assets}
                              value={newEntryDraft.assetId}
                              onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) =>
                                setNewEntryDraft({
                                  ...newEntryDraft,
                                  assetId: asset?.id ?? '',
                                  assetRecord: asset,
                                  division: asset?.divisionCode !== undefined ? String(asset.divisionCode) : newEntryDraft.division,
                                })
                              }
                              currentAsset={newEntryDraft.assetRecord}
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`add-division-${summary.employeeKey}`}>Division</Label>
                              <Input id={`add-division-${summary.employeeKey}`} className="bg-background" value={newEntryDraft.division} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, division: event.target.value.replace(/\D/g, '') })} placeholder="Optional division code" />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`add-job-${summary.employeeKey}`}>Job number</Label>
                              <Input id={`add-job-${summary.employeeKey}`} className="bg-background" value={newEntryDraft.jobNumber} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, jobNumber: event.target.value })} placeholder="Optional job note" />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`add-pay-type-${summary.employeeKey}`}>Pay type</Label>
                            <Select value={newEntryDraft.payTypeKey} onValueChange={(value: ShopTimeEntryPayTypeKey) => setNewEntryDraft({ ...newEntryDraft, payTypeKey: value })}>
                              <SelectTrigger id={`add-pay-type-${summary.employeeKey}`} className="w-full bg-background">
                                <SelectValue placeholder="Select pay type" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                  <SelectItem key={key} value={key}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`add-clock-in-${summary.employeeKey}`}>Clock in</Label>
                              <Input id={`add-clock-in-${summary.employeeKey}`} className="bg-background" type="time" value={newEntryDraft.clockInTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, clockInTime: event.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`add-clock-out-${summary.employeeKey}`}>Clock out</Label>
                              <Input id={`add-clock-out-${summary.employeeKey}`} className="bg-background" type="time" value={newEntryDraft.clockOutTime} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEntryDraft({ ...newEntryDraft, clockOutTime: event.target.value })} />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={() => void handleSaveNewEntry()} disabled={createTimeEntry.isPending}>Save time entry</Button>
                            <Button type="button" variant="outline" onClick={handleCancelAddEntry}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button type="button" variant="outline" className="w-full justify-center border-dashed" onClick={() => handleStartAddEntry(summary)}>
                            <Plus className="mr-2 h-4 w-4" /> Add time entry
                          </Button>
                          <Button type="button" variant="outline" className="w-full justify-center border-dashed" onClick={() => handleStartAddPto(summary.employeeKey)}>
                            <Plus className="mr-2 h-4 w-4" /> Add PTO
                          </Button>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </section>
              </Collapsible>
            );
          })}

        </CardContent>
      </Card>
    </main>
  );
}
