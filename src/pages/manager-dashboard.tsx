import { useEffect, useMemo, useState } from 'react';
import { eachDayOfInterval, format, startOfDay } from 'date-fns';
import {
  CalendarIcon,
  CalendarRange,
  Check,
  ChevronDown,
  Map as MapIcon,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AssetPicker } from '@/components/asset-picker';
import { AccessCheckingCard, ManagerAccessDeniedCard } from '@/components/system/access-cards';
import { ClockInLine } from '@/components/manager/clock-in-line';
import { EntryDistanceBadges, EntryDistanceField } from '@/components/manager/entry-distance-badges';
import { PtoApprovalPanel } from '@/components/manager/pto-approval-panel';
import { PayrollExportCard } from '@/components/manager/payroll-export-card';
import { useAllEquipmentAssets, useScheduleList, useShopEmployeeList, useShopTimeEntryList } from '@/hooks/use-shop-data';
import { useManagerEntryActions } from '@/hooks/use-manager-entry-actions';
import { useReloadTables } from '@/hooks/use-reload-tables';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { mapShopEmployees, type AppShopEmployee } from '@/lib/shop-employees';
import {
  emptyEntryDraft,
  emptyPtoDraft,
  type EditableEntry,
  type EmployeeDailySummary,
  type NewEntryDraft,
  type PtoDraft,
} from '@/lib/manager-timecard';
import {
  formatDuration,
  getDayPayMinutes,
  getPtoHours,
  getRawDurationMinutes,
  isPtoEntry,
  notesHaveAutoClockOut,
  scheduledStartFor,
  stripNoLunchMarker,
} from '@/lib/time-rules';
import {
  managerEntryTitle,
  entriesForManagerDisplay,
  getEntryJobNumber,
  getEntryEmployeeKey,
  getEntryEmployeeName,
  getEntryEmployeeNumber,
  getEntryDivision,
  getEntryWorkDateKey,
  getEmployeeNotes,
  formatTimeForInput,
  getWeekRange,
  formatWeekRangeLabel,
  scheduledStartCaption,
  dayClockCaption,
  isClockInOnlyRow,
} from '@/lib/entry-helpers';
import {
  ShopTimeEntryPayTypeKeyToLabel,
  ShopTimeEntryPTOTypeKeyToLabel,
  DEFAULT_PAY_TYPE,
  type ShopTimeEntry,
  type ShopTimeEntryPayTypeKey,
  type ShopTimeEntryPTOTypeKey,
} from '@/models/shop-time-entry';
import { NoLunchCheckbox } from '@/components/no-lunch-checkbox';
import { MechanicSchedule } from '@/components/manager/mechanic-schedule';
import { PunchMap } from '@/components/manager/punch-map';
import { toast } from '@/lib/toast';
import { useUser } from '@/hooks/use-user';

type ManagerView = 'timecards' | 'schedule' | 'map';

function StatTile({ label, value, caption }: { label: string; value: string | number; caption?: string }) {
  return (
    <div className="rounded-lg bg-muted p-4 text-muted-foreground">
      <p className="text-sm">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
      {caption ? <p className="mt-1 text-sm">{caption}</p> : null}
    </div>
  );
}

export default function ManagerDashboardPage() {
  const [managerView, setManagerView] = useState<ManagerView>('timecards');
  const [search, setSearch] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [exportWeekDate, setExportWeekDate] = useState<Date>(startOfDay(new Date()));
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
  const [rangeViewEmployeeId, setRangeViewEmployeeId] = useState('');
  const [rangeViewRange, setRangeViewRange] = useState<DateRange | undefined>(undefined);
  const [rangeOpenDay, setRangeOpenDay] = useState('');
  const [rangeAddingForDay, setRangeAddingForDay] = useState('');
  const [rangePtoForDay, setRangePtoForDay] = useState('');
  const { data: user, isLoading: userLoading, isError: userFailed, error: userError } = useUser();
  const { data: shopEmployees = [], isLoading: employeesLoading } = useShopEmployeeList();
  const employees = useMemo(() => mapShopEmployees(shopEmployees), [shopEmployees]);
  const { data: assets = [], isLoading: assetsLoading, refetch: refetchAssets } = useAllEquipmentAssets();
  const {
    data: timeEntries = [],
    isLoading: entriesLoading,
    isError: entriesIsError,
    error: entriesError,
    refetch: refetchEntries,
  } = useShopTimeEntryList();
  const isAllowedManager = Boolean(user?.isManager);
  const { saveNewEntry, saveEdit, savePto, deleteEntry, setDayNoLunch, lunchUpdatingKey, isCreating, isUpdating, isDeleting } =
    useManagerEntryActions({ employees, assets, timeEntries });
  const handleReloadTables = useReloadTables(refetchAssets, refetchEntries);

  const selectedDayKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedDayEntries = useMemo(() => {
    return timeEntries
      .filter((entry: ShopTimeEntry) => entry.clockIn && getEntryWorkDateKey(entry) === selectedDayKey)
      .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(b.clockIn ?? '').getTime() - new Date(a.clockIn ?? '').getTime());
  }, [selectedDayKey, timeEntries]);

  const scheduleQueryRange = useMemo(() => {
    // Cover the selected day as well as an open range view, so the daily totals
    // keep their scheduled starts while a range is on screen.
    if (rangeViewEmployeeId && rangeViewRange?.from && rangeViewRange?.to) {
      const from = rangeViewRange.from < selectedDate ? rangeViewRange.from : selectedDate;
      const to = rangeViewRange.to > selectedDate ? rangeViewRange.to : selectedDate;
      return {
        from: format(from, "yyyy-MM-dd'T'00:00:00'Z'"),
        to: format(to, "yyyy-MM-dd'T'23:59:59'Z'"),
      };
    }
    return {
      from: format(selectedDate, "yyyy-MM-dd'T'00:00:00'Z'"),
      to: format(selectedDate, "yyyy-MM-dd'T'23:59:59'Z'"),
    };
  }, [rangeViewEmployeeId, rangeViewRange, selectedDate]);
  const {
    data: viewSchedules = [],
    isError: viewSchedulesError,
    error: viewSchedulesErrorDetail,
  } = useScheduleList(scheduleQueryRange.from, scheduleQueryRange.to);
  const scheduleByEmployeeDay = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const row of viewSchedules) {
      if (row.employeeId && row.scheduleDate) {
        map.set(`${row.employeeId}-${row.scheduleDate.slice(0, 10)}`, row.scheduledStart);
      }
    }
    return map;
  }, [viewSchedules]);

  useEffect(() => {
    if (!viewSchedulesError) return;
    const message = viewSchedulesErrorDetail instanceof Error ? viewSchedulesErrorDetail.message : 'Schedule list failed to load.';
    toast.error(`Could not load scheduled starts. ${message}`);
  }, [viewSchedulesError, viewSchedulesErrorDetail]);

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
        onCall: false,
        scheduledStartLabel: '',
      };

      current.entries.push(entry);
      current.activeCount += entry.clockOut ? 0 : 1;
      summaries.set(employeeKey, current);
    });

    return Array.from(summaries.values())
      .map((summary: EmployeeDailySummary) => {
        const employeeId = summary.entries[0]?.employee?.id;
        const employee = employees.find((candidate: AppShopEmployee) => candidate.id === employeeId);
        const storedStart = employeeId ? scheduleByEmployeeDay.get(`${employeeId}-${selectedDayKey}`) : undefined;
        const pay = getDayPayMinutes(summary.entries, new Date(), scheduledStartFor(employee, storedStart), {
          isRoadMech: employee?.isRoadMech,
          isAdmin: employee?.isAdmin,
          isPartsRunner: employee?.isPartsRunner,
        });
        return {
          ...summary,
          totalMinutes: pay.totalMinutes,
          noLunch: pay.noLunch,
          lunchDeducted: pay.lunchDeducted,
          onCall: summary.entries.some((entry: ShopTimeEntry) => entry.onCall),
          scheduledStartLabel: scheduledStartCaption(employee, storedStart),
        };
      })
      .filter((summary: EmployeeDailySummary) => {
        const query = search.trim().toLowerCase();
        return !query || summary.employeeName.toLowerCase().includes(query) || summary.employeeNumber.toLowerCase().includes(query);
      })
      .sort((a: EmployeeDailySummary, b: EmployeeDailySummary) => a.employeeName.localeCompare(b.employeeName));
  }, [employees, scheduleByEmployeeDay, search, selectedDayEntries, selectedDayKey]);

  const exportWeekRange = useMemo(() => getWeekRange(exportWeekDate), [exportWeekDate]);
  const { data: exportSchedules = [] } = useScheduleList(
    format(exportWeekRange.start, "yyyy-MM-dd'T'00:00:00'Z'"),
    format(exportWeekRange.end, "yyyy-MM-dd'T'23:59:59'Z'"),
  );

  const weeklyEntries = useMemo(() => {
    return timeEntries
      .filter((entry: ShopTimeEntry) => {
        if (!entry.clockIn) return false;
        const workDay = getEntryWorkDateKey(entry);
        return workDay >= format(exportWeekRange.start, 'yyyy-MM-dd') && workDay <= format(exportWeekRange.end, 'yyyy-MM-dd');
      })
      .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
  }, [exportWeekRange, timeEntries]);

  const exportScheduleByEmployeeDay = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const row of exportSchedules) {
      if (row.employeeId && row.scheduleDate) map.set(`${row.employeeId}-${row.scheduleDate.slice(0, 10)}`, row.scheduledStart);
    }
    return map;
  }, [exportSchedules]);

  const weeklyPayrollMinutes = useMemo(() => {
    const groups = new Map<string, ShopTimeEntry[]>();
    weeklyEntries.forEach((entry: ShopTimeEntry) => {
      const key = `${getEntryEmployeeKey(entry)}|${getEntryWorkDateKey(entry)}`;
      const current = groups.get(key) ?? [];
      current.push(entry);
      groups.set(key, current);
    });
    return [...groups.values()].reduce((total: number, dayEntries: ShopTimeEntry[]) => {
      const employeeId = dayEntries[0]?.employee?.id;
      const employee = employees.find((candidate: AppShopEmployee) => candidate.id === employeeId);
      const storedStart = employeeId ? exportScheduleByEmployeeDay.get(`${employeeId}-${getEntryWorkDateKey(dayEntries[0])}`) : undefined;
      return (
        total +
        getDayPayMinutes(dayEntries, new Date(), scheduledStartFor(employee, storedStart), {
          isRoadMech: employee?.isRoadMech,
          isAdmin: employee?.isAdmin,
          isPartsRunner: employee?.isPartsRunner,
        }).totalMinutes
      );
    }, 0);
  }, [employees, exportScheduleByEmployeeDay, weeklyEntries]);

  const rangeViewEmployee = useMemo(() => {
    if (!rangeViewEmployeeId) return null;
    return employees.find((row: AppShopEmployee) => row.id === rangeViewEmployeeId) ?? null;
  }, [rangeViewEmployeeId, employees]);

  const rangeViewDays = useMemo(() => {
    if (!rangeViewEmployeeId || !rangeViewRange?.from || !rangeViewRange?.to) return [];
    const days = eachDayOfInterval({ start: rangeViewRange.from, end: rangeViewRange.to });
    return days.map((day: Date) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayEntries = timeEntries
        .filter(
          (entry: ShopTimeEntry) => entry.employee?.id === rangeViewEmployeeId && entry.clockIn && getEntryWorkDateKey(entry) === dayKey,
        )
        .sort((a: ShopTimeEntry, b: ShopTimeEntry) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
      const storedStart = scheduleByEmployeeDay.get(`${rangeViewEmployeeId}-${dayKey}`);
      const pay = getDayPayMinutes(dayEntries, new Date(), scheduledStartFor(rangeViewEmployee, storedStart), {
        isRoadMech: rangeViewEmployee?.isRoadMech,
        isAdmin: rangeViewEmployee?.isAdmin,
        isPartsRunner: rangeViewEmployee?.isPartsRunner,
      });
      return {
        day,
        dayKey,
        entries: dayEntries,
        totalMinutes: pay.totalMinutes,
        noLunch: pay.noLunch,
        lunchDeducted: pay.lunchDeducted,
        onCall: dayEntries.some((entry: ShopTimeEntry) => entry.onCall),
        scheduledStartLabel: scheduledStartCaption(rangeViewEmployee, storedStart),
      };
    });
  }, [rangeViewEmployee, rangeViewEmployeeId, rangeViewRange, scheduleByEmployeeDay, timeEntries]);

  const handleToggleEmployee = (employeeKey: string) => {
    setOpenEmployeeKeys((currentKeys: string[]) =>
      currentKeys.includes(employeeKey) ? currentKeys.filter((key: string) => key !== employeeKey) : [...currentKeys, employeeKey],
    );
  };
  const activeEmployeeCount = employeeSummaries.filter((summary: EmployeeDailySummary) => summary.activeCount > 0).length;
  const totalHours = formatDuration(
    employeeSummaries.reduce((total: number, summary: EmployeeDailySummary) => total + summary.totalMinutes, 0),
  );

  const handleStartEdit = (entry: ShopTimeEntry) => {
    handleCancelAddEntry();
    handleCancelPto();
    setEditingEntryId(entry.id);
    setEditValues({
      assetId: entry.asset?.id ?? '',
      assetRecord: entry.asset,
      division: getEntryDivision(entry, assets),
      jobNumber: getEntryJobNumber(entry),
      notes: stripNoLunchMarker(entry.notes),
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
      setOpenEmployeeKeys((currentKeys: string[]) => (currentKeys.includes(employeeId) ? currentKeys : [...currentKeys, employeeId]));
    }
  };

  const openEmployee = (employeeId: string) => {
    setOpenEmployeeKeys((currentKeys: string[]) => (currentKeys.includes(employeeId) ? currentKeys : [...currentKeys, employeeId]));
  };

  const handleSavePto = async () => {
    if (!ptoDraft) return;
    if (await savePto({ draft: ptoDraft, day: selectedDate })) {
      handleCancelPto();
      openEmployee(ptoDraft.employeeId);
    }
  };

  const handleSaveNewEntry = async () => {
    if (!newEntryDraft) return;
    if (await saveNewEntry({ draft: newEntryDraft, day: selectedDate })) {
      handleCancelAddEntry();
      openEmployee(newEntryDraft.employeeId);
    }
  };

  const handleSaveEdit = async (entry: ShopTimeEntry) => {
    if (!editValues) return;
    if (await saveEdit({ entry, editValues, dayEntries: selectedDayEntries })) {
      handleCancelEdit();
    }
  };

  const handleDeleteEntry = async (entry: ShopTimeEntry) => {
    if ((await deleteEntry(entry)) && editingEntryId === entry.id) {
      handleCancelEdit();
    }
  };

  const handleNoLunchChange = (summary: EmployeeDailySummary, checked: boolean) =>
    setDayNoLunch({
      entries: summary.entries,
      checked,
      updatingKey: summary.employeeKey,
      employeeName: summary.employeeName,
    });

  const handleRangeClearEdits = () => {
    setEditingEntryId('');
    setEditValues(null);
    setRangeAddingForDay('');
    setNewEntryDraft(null);
    setRangePtoForDay('');
    setPtoDraft(null);
  };

  const handleRangeStartEdit = (entry: ShopTimeEntry) => {
    setRangeAddingForDay('');
    setNewEntryDraft(null);
    setRangePtoForDay('');
    setPtoDraft(null);
    setEditingEntryId(entry.id);
    setEditValues({
      assetId: entry.asset?.id ?? '',
      assetRecord: entry.asset,
      division: getEntryDivision(entry, assets),
      jobNumber: getEntryJobNumber(entry),
      notes: stripNoLunchMarker(entry.notes),
      payTypeKey: entry.payTypeKey ?? DEFAULT_PAY_TYPE,
      clockInTime: formatTimeForInput(entry.clockIn),
      clockOutTime: formatTimeForInput(entry.clockOut),
    });
  };

  const handleRangeStartAddEntry = (dayKey: string) => {
    setEditingEntryId('');
    setEditValues(null);
    setRangePtoForDay('');
    setPtoDraft(null);
    setRangeAddingForDay(dayKey);
    setNewEntryDraft(emptyEntryDraft(rangeViewEmployeeId));
    setRangeOpenDay(dayKey);
  };

  const handleRangeCancelAddEntry = () => {
    setRangeAddingForDay('');
    setNewEntryDraft(null);
  };

  const handleRangeStartPto = (dayKey: string) => {
    setEditingEntryId('');
    setEditValues(null);
    setRangeAddingForDay('');
    setNewEntryDraft(null);
    setRangePtoForDay(dayKey);
    setPtoDraft(emptyPtoDraft(rangeViewEmployeeId));
    setRangeOpenDay(dayKey);
  };

  const handleRangeCancelPto = () => {
    setRangePtoForDay('');
    setPtoDraft(null);
  };

  const handleRangeSaveEdit = async (entry: ShopTimeEntry, dayEntries: ShopTimeEntry[]) => {
    if (!editValues) return;
    if (await saveEdit({ entry, editValues, dayEntries })) {
      handleCancelEdit();
    }
  };

  const handleRangeSaveNewEntry = async (day: Date) => {
    if (!newEntryDraft) return;
    if (await saveNewEntry({ draft: newEntryDraft, day })) {
      handleRangeCancelAddEntry();
    }
  };

  const handleRangeSavePto = async (day: Date) => {
    if (!ptoDraft) return;
    if (await savePto({ draft: ptoDraft, day })) {
      handleRangeCancelPto();
    }
  };

  const handleRangeNoLunchChange = (dayEntries: ShopTimeEntry[], dayKey: string, checked: boolean) =>
    setDayNoLunch({
      entries: dayEntries,
      checked,
      updatingKey: `${rangeViewEmployeeId}-${dayKey}`,
      employeeName: rangeViewEmployee?.employeeName ?? 'employee',
    });

  if (userFailed) {
    return (
      <AccessCheckingCard
        title="Microsoft 365 sign-in failed"
        message={userError instanceof Error ? userError.message : 'Refresh the page and sign in with Microsoft 365 again.'}
      />
    );
  }

  if (userLoading || !user) {
    return (
      <AccessCheckingCard
        title="Checking manager access"
        message="Loading your Microsoft 365 identity before opening the manager dashboard."
      />
    );
  }

  if (!isAllowedManager) {
    return (
      <ManagerAccessDeniedCard
        user={user}
        message="Your Microsoft 365 account is not currently on the manager allowlist for this dashboard."
        showAllowlistHint
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PtoApprovalPanel timeEntries={timeEntries} employees={employees} />

      <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <ShieldCheck className="h-6 w-6" /> Manager dashboard
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Access verified with Microsoft 365. Review daily activity and export a weekly Excel workbook.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-border bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setManagerView('timecards')}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${managerView === 'timecards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Employee Timecards
                </button>
                <button
                  type="button"
                  onClick={() => setManagerView('schedule')}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${managerView === 'schedule' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Mechanic Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setManagerView('map')}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${managerView === 'map' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Punch Map
                </button>
              </div>
              <Button type="button" variant="outline" onClick={() => void handleReloadTables()} disabled={assetsLoading || entriesLoading}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reload tables
              </Button>
              <Badge variant="secondary">{user?.name || user?.email || 'Shop manager'}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <StatTile label="Employees logged today" value={employeeSummaries.length} />
          <StatTile label="Currently active" value={activeEmployeeCount} />
          <StatTile label="Total shop time" value={totalHours} />
          <StatTile label="Export week" value={formatDuration(weeklyPayrollMinutes)} caption={formatWeekRangeLabel(exportWeekDate)} />
        </CardContent>
      </Card>

      {managerView === 'schedule' ? <MechanicSchedule employees={employees} timeEntries={timeEntries} /> : null}

      {managerView === 'map' ? (
        <PunchMap
          selectedDate={selectedDate}
          onSelectDate={(date: Date) => {
            setSelectedDate(date);
            setOpenEmployeeKeys([]);
            handleCancelEdit();
            handleCancelAddEntry();
            handleCancelPto();
          }}
          timeEntries={timeEntries}
          employees={employees}
          assets={assets}
          isLoading={employeesLoading || entriesLoading || assetsLoading}
          loadError={entriesIsError ? (entriesError instanceof Error ? entriesError.message : 'Time entries failed to load.') : undefined}
        />
      ) : null}

      {managerView === 'timecards' && !rangeViewEmployeeId ? (
        <Card className="bg-card text-card-foreground shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 shrink-0">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Users className="h-5 w-5" /> Employee timecards
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{format(selectedDate, 'EEEE, MMM d')}</p>
              </div>
              <div className="grid w-full min-w-0 gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,10.5rem)_minmax(0,6.5rem)_minmax(12rem,1fr)_auto_auto] xl:items-center xl:max-w-4xl xl:justify-end">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-9 w-full justify-start bg-background">
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{format(selectedDate, 'MMM d, yyyy')}</span>
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
                <Button type="button" variant="secondary" onClick={() => setManagerView('map')} className="h-9 w-full whitespace-nowrap">
                  <MapIcon className="mr-2 h-4 w-4 shrink-0" /> See Map
                </Button>
                <div className="relative min-w-0 sm:col-span-2 xl:col-span-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                    className="h-9 pl-9"
                    placeholder="Search employee"
                  />
                </div>
                <Button type="button" variant="secondary" onClick={handleStartMissedEntry} className="h-9 w-full whitespace-nowrap">
                  <Plus className="mr-2 h-4 w-4 shrink-0" /> Add missed entry
                </Button>
                <Button type="button" variant="secondary" onClick={() => handleStartAddPto()} className="h-9 w-full whitespace-nowrap">
                  <Plus className="mr-2 h-4 w-4 shrink-0" /> Add PTO
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {employeesLoading || entriesLoading || assetsLoading ? (
              <p className="text-sm text-muted-foreground">Loading manager dashboard...</p>
            ) : null}
            {viewSchedulesError ? (
              <p className="text-sm text-destructive">
                Scheduled starts could not be loaded
                {viewSchedulesErrorDetail instanceof Error ? ` — ${viewSchedulesErrorDetail.message}` : '.'} Shop starts are shown as 7:00
                AM until this succeeds.
              </p>
            ) : null}
            {showPtoForm && ptoDraft ? (
              <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">Add PTO</p>
                    <p className="text-sm">4 or 8 hours of paid time off for {format(selectedDate, 'EEEE, MMM d')}.</p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label="Cancel PTO" onClick={handleCancelPto}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pto-employee-search">Employee</Label>
                  <Input
                    id="pto-employee-search"
                    className="bg-background"
                    value={
                      ptoEmployeeSearch || (employees.find((row: AppShopEmployee) => row.id === ptoDraft.employeeId)?.employeeName ?? '')
                    }
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
                    <Select
                      value={ptoDraft.type || undefined}
                      onValueChange={(value: ShopTimeEntryPTOTypeKey) => setPtoDraft({ ...ptoDraft, type: value })}
                    >
                      <SelectTrigger id="manager-pto-type" className="w-full bg-background">
                        <SelectValue placeholder="Select PTO type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ShopTimeEntryPTOTypeKeyToLabel).map(([key, label]) => (
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
                      <Button
                        type="button"
                        variant={ptoDraft.hours === 4 ? 'default' : 'outline'}
                        onClick={() => setPtoDraft({ ...ptoDraft, hours: 4 })}
                      >
                        4 hours
                      </Button>
                      <Button
                        type="button"
                        variant={ptoDraft.hours === 8 ? 'default' : 'outline'}
                        onClick={() => setPtoDraft({ ...ptoDraft, hours: 8 })}
                      >
                        8 hours
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSavePto()} disabled={isCreating}>
                    Save PTO
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancelPto}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {showMissedEntryForm && newEntryDraft ? (
              <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">Add missed time entry</p>
                    <p className="text-sm">
                      For an employee with no punches yet on {format(selectedDate, 'MMM d')}, or anyone who forgot an asset.
                    </p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label="Cancel missed entry" onClick={handleCancelAddEntry}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="missed-employee-search">Employee</Label>
                  <Input
                    id="missed-employee-search"
                    className="bg-background"
                    value={
                      missedEmployeeSearch ||
                      (employees.find((row: AppShopEmployee) => row.id === newEntryDraft.employeeId)?.employeeName ?? '')
                    }
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
                    <Input
                      id="missed-division"
                      className="bg-background"
                      value={newEntryDraft.division}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setNewEntryDraft({ ...newEntryDraft, division: event.target.value.replace(/\D/g, '') })
                      }
                      placeholder="Optional division code"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="missed-job">Job number</Label>
                    <Input
                      id="missed-job"
                      className="bg-background"
                      value={newEntryDraft.jobNumber}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setNewEntryDraft({ ...newEntryDraft, jobNumber: event.target.value })
                      }
                      placeholder="Optional job note"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="missed-pay-type">Pay type</Label>
                  <Select
                    value={newEntryDraft.payTypeKey}
                    onValueChange={(value: ShopTimeEntryPayTypeKey) => setNewEntryDraft({ ...newEntryDraft, payTypeKey: value })}
                  >
                    <SelectTrigger id="missed-pay-type" className="w-full bg-background">
                      <SelectValue placeholder="Select pay type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="missed-clock-in">Clock in</Label>
                    <Input
                      id="missed-clock-in"
                      className="bg-background"
                      type="time"
                      value={newEntryDraft.clockInTime}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setNewEntryDraft({ ...newEntryDraft, clockInTime: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="missed-clock-out">Clock out</Label>
                    <Input
                      id="missed-clock-out"
                      className="bg-background"
                      type="time"
                      value={newEntryDraft.clockOutTime}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setNewEntryDraft({ ...newEntryDraft, clockOutTime: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSaveNewEntry()} disabled={isCreating}>
                    Save time entry
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancelAddEntry}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {!entriesLoading && employeeSummaries.length === 0 && !showMissedEntryForm && !showPtoForm ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No employees have timecard entries for the selected day. Use Add missed entry or Add PTO if needed.
              </p>
            ) : null}
            {employeeSummaries.map((summary: EmployeeDailySummary) => {
              const isOpen = openEmployeeKeys.includes(summary.employeeKey);
              const displayEntries = entriesForManagerDisplay(summary.entries);
              const jobCount = displayEntries.filter((entry: ShopTimeEntry) => !isClockInOnlyRow(entry)).length;
              const needsReview = summary.entries.some((entry: ShopTimeEntry) => notesHaveAutoClockOut(entry.notes));
              const dayClockLabel = dayClockCaption(summary.entries);
              return (
                <Collapsible key={summary.employeeKey} open={isOpen} onOpenChange={() => handleToggleEmployee(summary.employeeKey)} asChild>
                  <section className="rounded-lg border border-border bg-background">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <h2 className="text-lg font-semibold">{summary.employeeName}</h2>
                          <p className="text-sm text-muted-foreground">
                            Employee {summary.employeeNumber} · {summary.scheduledStartLabel}
                            {dayClockLabel ? ` · ${dayClockLabel}` : ''} · {jobCount} {jobCount === 1 ? 'entry' : 'entries'} ·{' '}
                            {formatDuration(summary.totalMinutes)}
                            {summary.noLunch ? ' · No lunch' : summary.lunchDeducted ? ' · Lunch 0.5h' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={summary.activeCount > 0 ? 'default' : 'outline'}>
                            {summary.activeCount > 0 ? 'Active now' : 'Complete'}
                          </Badge>
                          {needsReview ? <Badge variant="secondary">Needs review</Badge> : null}
                          {summary.noLunch ? <Badge variant="secondary">No lunch</Badge> : null}
                          {summary.onCall ? (
                            <Badge variant="secondary">
                              <Phone className="mr-1 h-3 w-3" /> On Call
                            </Badge>
                          ) : null}
                          <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                      <NoLunchCheckbox
                        checked={summary.noLunch}
                        disabled={lunchUpdatingKey === summary.employeeKey}
                        onCheckedChange={(checked: boolean) => void handleNoLunchChange(summary, checked)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRangeViewEmployeeId(summary.employeeKey);
                          setRangeViewRange(undefined);
                          setRangeOpenDay('');
                        }}
                      >
                        <CalendarRange className="mr-2 h-4 w-4" /> Date range
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-3 border-t border-border p-4">
                        {displayEntries.map((entry: ShopTimeEntry) => {
                          const isEditing = editingEntryId === entry.id;
                          if (isClockInOnlyRow(entry)) {
                            return (
                              <ClockInLine
                                key={entry.id}
                                entry={entry}
                                isEditing={isEditing && Boolean(editValues)}
                                value={editValues?.clockInTime ?? ''}
                                isSaving={isUpdating}
                                onChange={(clockInTime: string) => editValues && setEditValues({ ...editValues, clockInTime })}
                                onStartEdit={() => handleStartEdit(entry)}
                                onSave={() => void handleSaveEdit(entry)}
                                onCancel={handleCancelEdit}
                              />
                            );
                          }
                          return (
                            <div key={entry.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-start">
                                <div className="space-y-2">
                                  <p className="text-sm text-muted-foreground">Asset / job</p>
                                  {isEditing && editValues ? (
                                    <div className="space-y-3">
                                      <AssetPicker
                                        assets={assets}
                                        value={editValues.assetId}
                                        onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) =>
                                          setEditValues({
                                            ...editValues,
                                            assetId: asset?.id ?? '',
                                            assetRecord: asset,
                                            division: asset?.divisionCode ? String(asset.divisionCode) : editValues.division,
                                          })
                                        }
                                        currentAsset={editValues.assetRecord ?? entry.asset}
                                      />
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                          <Label htmlFor={`division-${entry.id}`}>Division</Label>
                                          <Input
                                            id={`division-${entry.id}`}
                                            value={editValues.division}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditValues({ ...editValues, division: event.target.value.replace(/\D/g, '') })
                                            }
                                            placeholder="Optional division code"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`job-number-${entry.id}`}>Job Number</Label>
                                          <Input
                                            id={`job-number-${entry.id}`}
                                            value={editValues.jobNumber}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditValues({ ...editValues, jobNumber: event.target.value })
                                            }
                                            placeholder="Optional job note"
                                          />
                                        </div>
                                      </div>
                                      {!isPtoEntry(entry) ? (
                                        <div className="space-y-2">
                                          <Label htmlFor={`pay-type-${entry.id}`}>Pay type</Label>
                                          <Select
                                            value={editValues.payTypeKey}
                                            onValueChange={(value: ShopTimeEntryPayTypeKey) =>
                                              setEditValues({ ...editValues, payTypeKey: value })
                                            }
                                          >
                                            <SelectTrigger id={`pay-type-${entry.id}`} className="w-full bg-background">
                                              <SelectValue placeholder="Select pay type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>
                                                  {label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ) : null}
                                      <div className="space-y-2">
                                        <Label htmlFor={`notes-${entry.id}`}>Notes</Label>
                                        <Textarea
                                          id={`notes-${entry.id}`}
                                          className="bg-background"
                                          value={editValues.notes}
                                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                                            setEditValues({ ...editValues, notes: event.target.value })
                                          }
                                          placeholder="Optional notes"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-base font-semibold">{managerEntryTitle(entry, assets)}</p>
                                        {entry.pTOTypeKey ? (
                                          <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge>
                                        ) : null}
                                        {!isPtoEntry(entry) ? (
                                          <Badge variant="outline">
                                            {ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey ?? DEFAULT_PAY_TYPE]}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        {isPtoEntry(entry)
                                          ? `${getPtoHours(entry)} hours PTO`
                                          : `Division ${getEntryDivision(entry, assets) || '—'} · Job ${getEntryJobNumber(entry) || '—'}`}
                                      </p>
                                    </div>
                                  )}
                                </div>

                                <div className={`grid gap-3 ${isEditing ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                                  <div className="space-y-2">
                                    <Label htmlFor={`clock-in-${entry.id}`}>Clock in</Label>
                                    {isEditing && editValues ? (
                                      <Input
                                        id={`clock-in-${entry.id}`}
                                        type="time"
                                        value={editValues.clockInTime}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                          setEditValues({ ...editValues, clockInTime: event.target.value })
                                        }
                                      />
                                    ) : (
                                      <p className="font-semibold">{entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'}</p>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor={`clock-out-${entry.id}`}>Clock out</Label>
                                    {isEditing && editValues ? (
                                      <Input
                                        id={`clock-out-${entry.id}`}
                                        type="time"
                                        value={editValues.clockOutTime}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                          setEditValues({ ...editValues, clockOutTime: event.target.value })
                                        }
                                      />
                                    ) : (
                                      <p className="font-semibold">{entry.clockOut ? format(new Date(entry.clockOut), 'p') : 'Active'}</p>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Duration</Label>
                                    <p className="font-semibold">{formatDuration(getRawDurationMinutes(entry))}</p>
                                  </div>
                                  <EntryDistanceField entry={entry} />
                                </div>

                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                  <Badge variant={entry.clockOut ? 'outline' : 'default'}>{entry.clockOut ? 'Complete' : 'Active'}</Badge>
                                  {notesHaveAutoClockOut(entry.notes) ? <Badge variant="secondary">Needs review</Badge> : null}
                                  {isEditing ? (
                                    <>
                                      <Button
                                        type="button"
                                        size="icon"
                                        aria-label="Save row"
                                        onClick={() => void handleSaveEdit(entry)}
                                        disabled={isUpdating}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        aria-label="Cancel row edit"
                                        onClick={handleCancelEdit}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <Button type="button" variant="outline" size="sm" onClick={() => handleStartEdit(entry)}>
                                      <Pencil className="mr-2 h-4 w-4" /> Edit
                                    </Button>
                                  )}
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button type="button" variant="destructive" size="sm" disabled={isDeleting}>
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This removes {summary.employeeName}&apos;s {format(selectedDate, 'MMM d')} time entry for{' '}
                                          {managerEntryTitle(entry, assets)} from Dataverse and the weekly timecard export.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => void handleDeleteEntry(entry)}>
                                          Delete time entry
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                              {getEmployeeNotes(entry.notes) ? (
                                <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                                  {getEmployeeNotes(entry.notes)}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                        {addingForEmployeeKey === summary.employeeKey && newEntryDraft ? (
                          <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted p-4 text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-foreground">Add time entry</p>
                                <p className="text-sm">
                                  Split a forgotten multi-asset day by adding another punch for {summary.employeeName}.
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Cancel add entry"
                                onClick={handleCancelAddEntry}
                              >
                                <X className="h-4 w-4" />
                              </Button>
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
                                <Input
                                  id={`add-division-${summary.employeeKey}`}
                                  className="bg-background"
                                  value={newEntryDraft.division}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    setNewEntryDraft({ ...newEntryDraft, division: event.target.value.replace(/\D/g, '') })
                                  }
                                  placeholder="Optional division code"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`add-job-${summary.employeeKey}`}>Job number</Label>
                                <Input
                                  id={`add-job-${summary.employeeKey}`}
                                  className="bg-background"
                                  value={newEntryDraft.jobNumber}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    setNewEntryDraft({ ...newEntryDraft, jobNumber: event.target.value })
                                  }
                                  placeholder="Optional job note"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`add-pay-type-${summary.employeeKey}`}>Pay type</Label>
                              <Select
                                value={newEntryDraft.payTypeKey}
                                onValueChange={(value: ShopTimeEntryPayTypeKey) =>
                                  setNewEntryDraft({ ...newEntryDraft, payTypeKey: value })
                                }
                              >
                                <SelectTrigger id={`add-pay-type-${summary.employeeKey}`} className="w-full bg-background">
                                  <SelectValue placeholder="Select pay type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                    <SelectItem key={key} value={key}>
                                      {label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`add-clock-in-${summary.employeeKey}`}>Clock in</Label>
                                <Input
                                  id={`add-clock-in-${summary.employeeKey}`}
                                  className="bg-background"
                                  type="time"
                                  value={newEntryDraft.clockInTime}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    setNewEntryDraft({ ...newEntryDraft, clockInTime: event.target.value })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`add-clock-out-${summary.employeeKey}`}>Clock out</Label>
                                <Input
                                  id={`add-clock-out-${summary.employeeKey}`}
                                  className="bg-background"
                                  type="time"
                                  value={newEntryDraft.clockOutTime}
                                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                    setNewEntryDraft({ ...newEntryDraft, clockOutTime: event.target.value })
                                  }
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" onClick={() => void handleSaveNewEntry()} disabled={isCreating}>
                                Save time entry
                              </Button>
                              <Button type="button" variant="outline" onClick={handleCancelAddEntry}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full justify-center border-dashed"
                              onClick={() => handleStartAddEntry(summary)}
                            >
                              <Plus className="mr-2 h-4 w-4" /> Add time entry
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full justify-center border-dashed"
                              onClick={() => handleStartAddPto(summary.employeeKey)}
                            >
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
      ) : null}

      {managerView === 'timecards' && rangeViewEmployeeId ? (
        <Card className="bg-card text-card-foreground shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CalendarRange className="h-5 w-5" /> Date range
                </CardTitle>
                <Select
                  value={rangeViewEmployeeId}
                  onValueChange={(id: string) => {
                    setRangeViewEmployeeId(id);
                    setRangeOpenDay('');
                    handleRangeClearEdits();
                  }}
                >
                  <SelectTrigger className="w-auto min-w-48 bg-background">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp: AppShopEmployee) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.employeeName}
                        {emp.isAdmin ? ' (Admin)' : emp.isPartsRunner ? ' (Parts)' : emp.isRoadMech ? ' (Road)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                        handleRangeClearEdits();
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRangeViewEmployeeId('');
                    handleRangeClearEdits();
                  }}
                >
                  <X className="mr-2 h-4 w-4" /> Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {viewSchedulesError ? (
              <p className="text-sm text-destructive">
                Scheduled starts could not be loaded
                {viewSchedulesErrorDetail instanceof Error ? ` — ${viewSchedulesErrorDetail.message}` : '.'} Shop starts are shown as 7:00
                AM until this succeeds.
              </p>
            ) : null}
            {!rangeViewRange?.from ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Use the date picker above to select a range of days.</p>
            ) : !rangeViewRange?.to ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Click a second date to complete the range.</p>
            ) : null}

            {rangeViewDays.map(
              ({
                day,
                dayKey,
                entries: dayEntries,
                totalMinutes: dayMinutes,
                noLunch: dayNoLunch,
                onCall: dayOnCall,
                scheduledStartLabel,
              }) => {
                const displayDayEntries = entriesForManagerDisplay(dayEntries);
                const dayJobCount = displayDayEntries.filter((entry: ShopTimeEntry) => !isClockInOnlyRow(entry)).length;
                const dayNeedsReview = dayEntries.some((entry: ShopTimeEntry) => notesHaveAutoClockOut(entry.notes));
                const dayClockLabel = dayClockCaption(dayEntries);
                return (
                  <Collapsible
                    key={dayKey}
                    open={rangeOpenDay === dayKey}
                    onOpenChange={() => setRangeOpenDay(rangeOpenDay === dayKey ? '' : dayKey)}
                    asChild
                  >
                    <section className="rounded-lg border border-border bg-background">
                      <CollapsibleTrigger asChild>
                        <button type="button" className="flex w-full items-center justify-between p-3 text-left">
                          <div>
                            <p className="font-semibold text-sm">{format(day, 'EEEE, MMM d')}</p>
                            <p className="text-xs text-muted-foreground">
                              {scheduledStartLabel}
                              {dayClockLabel ? ` · ${dayClockLabel}` : ''} · {dayJobCount} {dayJobCount === 1 ? 'entry' : 'entries'} ·{' '}
                              {formatDuration(dayMinutes)}
                              {dayNoLunch ? ' · No lunch' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {dayJobCount === 0 ? (
                              <Badge variant="outline">{dayClockLabel ? 'Clocked in' : 'No entries'}</Badge>
                            ) : (
                              <Badge variant="secondary">{formatDuration(dayMinutes)}</Badge>
                            )}
                            {dayNeedsReview ? <Badge variant="secondary">Needs review</Badge> : null}
                            {dayNoLunch ? <Badge variant="secondary">No lunch</Badge> : null}
                            {dayOnCall ? (
                              <Badge variant="secondary">
                                <Phone className="mr-1 h-3 w-3" />
                                On Call
                              </Badge>
                            ) : null}
                            <ChevronDown className={`h-4 w-4 transition-transform ${rangeOpenDay === dayKey ? 'rotate-180' : ''}`} />
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
                          <NoLunchCheckbox
                            checked={dayNoLunch}
                            disabled={lunchUpdatingKey === `${rangeViewEmployeeId}-${dayKey}`}
                            onCheckedChange={(checked: boolean) => void handleRangeNoLunchChange(dayEntries, dayKey, checked)}
                          />
                        </div>
                        <div className="space-y-2 border-t border-border p-3">
                          {displayDayEntries.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {dayClockLabel ? `${dayClockLabel}.` : 'No entries for this day.'}
                            </p>
                          ) : null}
                          {displayDayEntries.map((entry: ShopTimeEntry) => {
                            const isRangeEditing = editingEntryId === entry.id;
                            if (isClockInOnlyRow(entry)) {
                              return (
                                <ClockInLine
                                  key={entry.id}
                                  entry={entry}
                                  isEditing={isRangeEditing && Boolean(editValues)}
                                  value={editValues?.clockInTime ?? ''}
                                  isSaving={isUpdating}
                                  onChange={(clockInTime: string) => editValues && setEditValues({ ...editValues, clockInTime })}
                                  onStartEdit={() => handleRangeStartEdit(entry)}
                                  onSave={() => void handleRangeSaveEdit(entry, dayEntries)}
                                  onCancel={handleCancelEdit}
                                />
                              );
                            }
                            return (
                              <div key={entry.id} className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                                {isRangeEditing && editValues ? (
                                  <div className="space-y-3">
                                    <div className="space-y-2">
                                      <p className="text-xs text-muted-foreground">Asset / job</p>
                                      <AssetPicker
                                        assets={assets}
                                        value={editValues.assetId}
                                        onChange={(asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) =>
                                          setEditValues({
                                            ...editValues,
                                            assetId: asset?.id ?? '',
                                            assetRecord: asset,
                                            division: asset?.divisionCode ? String(asset.divisionCode) : editValues.division,
                                          })
                                        }
                                        currentAsset={editValues.assetRecord ?? entry.asset}
                                      />
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                          <Label htmlFor={`range-div-${entry.id}`}>Division</Label>
                                          <Input
                                            id={`range-div-${entry.id}`}
                                            value={editValues.division}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditValues({ ...editValues, division: event.target.value.replace(/\D/g, '') })
                                            }
                                            placeholder="Optional division code"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`range-job-${entry.id}`}>Job Number</Label>
                                          <Input
                                            id={`range-job-${entry.id}`}
                                            value={editValues.jobNumber}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                              setEditValues({ ...editValues, jobNumber: event.target.value })
                                            }
                                            placeholder="Optional job note"
                                          />
                                        </div>
                                      </div>
                                      {!isPtoEntry(entry) ? (
                                        <div className="space-y-2">
                                          <Label htmlFor={`range-pay-${entry.id}`}>Pay type</Label>
                                          <Select
                                            value={editValues.payTypeKey}
                                            onValueChange={(value: ShopTimeEntryPayTypeKey) =>
                                              setEditValues({ ...editValues, payTypeKey: value })
                                            }
                                          >
                                            <SelectTrigger id={`range-pay-${entry.id}`} className="w-full bg-background">
                                              <SelectValue placeholder="Select pay type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>
                                                  {label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ) : null}
                                      <div className="space-y-2">
                                        <Label htmlFor={`range-notes-${entry.id}`}>Notes</Label>
                                        <Textarea
                                          id={`range-notes-${entry.id}`}
                                          className="bg-background"
                                          value={editValues.notes}
                                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                                            setEditValues({ ...editValues, notes: event.target.value })
                                          }
                                          placeholder="Optional notes"
                                        />
                                      </div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                      <div className="space-y-2">
                                        <Label htmlFor={`range-ci-${entry.id}`}>Clock in</Label>
                                        <Input
                                          id={`range-ci-${entry.id}`}
                                          type="time"
                                          value={editValues.clockInTime}
                                          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                            setEditValues({ ...editValues, clockInTime: event.target.value })
                                          }
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`range-co-${entry.id}`}>Clock out</Label>
                                        <Input
                                          id={`range-co-${entry.id}`}
                                          type="time"
                                          value={editValues.clockOutTime}
                                          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                            setEditValues({ ...editValues, clockOutTime: event.target.value })
                                          }
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Duration</Label>
                                        <p className="font-semibold text-sm">{formatDuration(getRawDurationMinutes(entry))}</p>
                                      </div>
                                      <EntryDistanceField entry={entry} />
                                    </div>
                                    <div className="flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => void handleRangeSaveEdit(entry, dayEntries)}
                                        disabled={isUpdating}
                                      >
                                        <Check className="mr-1 h-3 w-3" /> Save
                                      </Button>
                                      <Button type="button" size="sm" variant="outline" onClick={handleCancelEdit}>
                                        <X className="mr-1 h-3 w-3" /> Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-sm">{managerEntryTitle(entry, assets)}</p>
                                        {isPtoEntry(entry) && entry.pTOTypeKey ? (
                                          <Badge variant="outline">{ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey]}</Badge>
                                        ) : null}
                                        {!isPtoEntry(entry) ? (
                                          <Badge variant="outline">
                                            {ShopTimeEntryPayTypeKeyToLabel[entry.payTypeKey ?? DEFAULT_PAY_TYPE]}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        {entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—'} –{' '}
                                        {entry.clockOut ? format(new Date(entry.clockOut), 'p') : 'Active'}
                                        {isPtoEntry(entry)
                                          ? ` · ${getPtoHours(entry)}h PTO`
                                          : ` · Div ${getEntryDivision(entry, assets) || '—'}`}
                                        {getEntryJobNumber(entry) ? ` · Job ${getEntryJobNumber(entry)}` : ''}
                                        {' · '}
                                        {formatDuration(getRawDurationMinutes(entry))}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <EntryDistanceBadges entry={entry} />
                                      {entry.onCall ? (
                                        <Badge variant="secondary">
                                          <Phone className="mr-1 h-3 w-3" />
                                          On Call
                                        </Badge>
                                      ) : null}
                                      <Badge variant={entry.clockOut ? 'outline' : 'default'}>
                                        {entry.clockOut ? 'Complete' : 'Active'}
                                      </Badge>
                                      {notesHaveAutoClockOut(entry.notes) ? <Badge variant="secondary">Needs review</Badge> : null}
                                      <Button type="button" variant="outline" size="sm" onClick={() => handleRangeStartEdit(entry)}>
                                        <Pencil className="mr-1 h-3 w-3" /> Edit
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button type="button" variant="destructive" size="sm" disabled={isDeleting}>
                                            <Trash2 className="mr-1 h-3 w-3" /> Delete
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This removes {rangeViewEmployee?.employeeName ?? 'this employee'}&apos;s{' '}
                                              {format(day, 'MMM d')} time entry for {managerEntryTitle(entry, assets)} from Dataverse and
                                              the weekly timecard export.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => void handleDeleteEntry(entry)}>
                                              Delete time entry
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </div>
                                )}
                                {getEmployeeNotes(entry.notes) ? (
                                  <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                                    {getEmployeeNotes(entry.notes)}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                          {rangeAddingForDay === dayKey && newEntryDraft ? (
                            <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-medium text-sm text-foreground">Add time entry for {format(day, 'MMM d')}</p>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Cancel add entry"
                                  onClick={handleRangeCancelAddEntry}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
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
                                  <Label htmlFor={`range-add-div-${dayKey}`}>Division</Label>
                                  <Input
                                    id={`range-add-div-${dayKey}`}
                                    className="bg-background"
                                    value={newEntryDraft.division}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                      setNewEntryDraft({ ...newEntryDraft, division: event.target.value.replace(/\D/g, '') })
                                    }
                                    placeholder="Optional division code"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`range-add-job-${dayKey}`}>Job number</Label>
                                  <Input
                                    id={`range-add-job-${dayKey}`}
                                    className="bg-background"
                                    value={newEntryDraft.jobNumber}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                      setNewEntryDraft({ ...newEntryDraft, jobNumber: event.target.value })
                                    }
                                    placeholder="Optional job note"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`range-add-pay-${dayKey}`}>Pay type</Label>
                                <Select
                                  value={newEntryDraft.payTypeKey}
                                  onValueChange={(value: ShopTimeEntryPayTypeKey) =>
                                    setNewEntryDraft({ ...newEntryDraft, payTypeKey: value })
                                  }
                                >
                                  <SelectTrigger id={`range-add-pay-${dayKey}`} className="w-full bg-background">
                                    <SelectValue placeholder="Select pay type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(ShopTimeEntryPayTypeKeyToLabel).map(([key, label]) => (
                                      <SelectItem key={key} value={key}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`range-add-ci-${dayKey}`}>Clock in</Label>
                                  <Input
                                    id={`range-add-ci-${dayKey}`}
                                    className="bg-background"
                                    type="time"
                                    value={newEntryDraft.clockInTime}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                      setNewEntryDraft({ ...newEntryDraft, clockInTime: event.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`range-add-co-${dayKey}`}>Clock out</Label>
                                  <Input
                                    id={`range-add-co-${dayKey}`}
                                    className="bg-background"
                                    type="time"
                                    value={newEntryDraft.clockOutTime}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                      setNewEntryDraft({ ...newEntryDraft, clockOutTime: event.target.value })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button type="button" size="sm" onClick={() => void handleRangeSaveNewEntry(day)} disabled={isCreating}>
                                  Save time entry
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={handleRangeCancelAddEntry}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          {rangePtoForDay === dayKey && ptoDraft ? (
                            <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-medium text-sm text-foreground">Add PTO for {format(day, 'MMM d')}</p>
                                <Button type="button" size="icon" variant="ghost" aria-label="Cancel PTO" onClick={handleRangeCancelPto}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`range-pto-type-${dayKey}`}>PTO type</Label>
                                  <Select
                                    value={ptoDraft.type || undefined}
                                    onValueChange={(value: ShopTimeEntryPTOTypeKey) => setPtoDraft({ ...ptoDraft, type: value })}
                                  >
                                    <SelectTrigger id={`range-pto-type-${dayKey}`} className="w-full bg-background">
                                      <SelectValue placeholder="Select PTO type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(ShopTimeEntryPTOTypeKeyToLabel).map(([key, label]) => (
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
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={ptoDraft.hours === 4 ? 'default' : 'outline'}
                                      onClick={() => setPtoDraft({ ...ptoDraft, hours: 4 })}
                                    >
                                      4 hours
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={ptoDraft.hours === 8 ? 'default' : 'outline'}
                                      onClick={() => setPtoDraft({ ...ptoDraft, hours: 8 })}
                                    >
                                      8 hours
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button type="button" size="sm" onClick={() => void handleRangeSavePto(day)} disabled={isCreating}>
                                  Save PTO
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={handleRangeCancelPto}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          {rangeAddingForDay !== dayKey && rangePtoForDay !== dayKey ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full justify-center border-dashed"
                                onClick={() => handleRangeStartAddEntry(dayKey)}
                              >
                                <Plus className="mr-1 h-3 w-3" /> Add time entry
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full justify-center border-dashed"
                                onClick={() => handleRangeStartPto(dayKey)}
                              >
                                <Plus className="mr-1 h-3 w-3" /> Add PTO
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </CollapsibleContent>
                    </section>
                  </Collapsible>
                );
              },
            )}

            {rangeViewRange?.from && rangeViewRange?.to && rangeViewDays.every((d) => d.entries.length === 0) ? (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No entries found for {rangeViewEmployee?.employeeName ?? 'this employee'} in the selected date range.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {managerView === 'timecards' ? (
        <PayrollExportCard
          exportWeekDate={exportWeekDate}
          onExportWeekDateChange={setExportWeekDate}
          weeklyEntries={weeklyEntries}
          weeklyPayrollMinutes={weeklyPayrollMinutes}
          employees={employees}
          assets={assets}
          schedules={exportSchedules}
        />
      ) : null}
    </main>
  );
}
