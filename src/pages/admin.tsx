import { memo, useCallback, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SortableTableHeader, type SortState } from '@/components/admin/sortable-table-header';
import { AccessCheckingCard, ManagerAccessDeniedCard } from '@/components/system/access-cards';
import { compareNumber, compareText, EMPTY_SORT, toggleSort, type SortDirection } from '@/lib/admin-table';
import {
  useAllEquipmentAssets,
  useCreateAsset,
  useUpdateAsset,
  useDeactivateAsset,
  useShopEmployeeList,
  useCreateShopEmployee,
  useDeactivateShopEmployee,
  useLookupEmployees,
  type LookupEmployee,
} from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';
import { useUser } from '@/hooks/use-user';
import { DIVISIONS, EQUIPMENT_CATEGORIES, divisionLabel, picklistForCode, categoryLabel } from '@/lib/reference-data';
import {
  employeeMechanicType,
  employeeMechanicTypeLabel,
  formatEmployeeDisplayName,
  MECHANIC_TYPE_ORDER,
  shopEmployeeDisplayName,
} from '@/lib/shop-employees';

// ─── Asset editor ────────────────────────────────────────────────────────────

type AssetDraft = { asset: string; assetDetail: string; divisionCode: string; equipmentCategory: string };
const emptyAssetDraft: AssetDraft = { asset: '', assetDetail: '', divisionCode: '', equipmentCategory: '' };

function AssetForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  title,
}: {
  draft: AssetDraft;
  onChange: (d: AssetDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
}) {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Asset ID</Label>
            <Input value={draft.asset} onChange={(e) => onChange({ ...draft, asset: e.target.value })} placeholder="e.g. PT500" />
          </div>
          <div>
            <Label>Equipment Category</Label>
            <Select value={draft.equipmentCategory} onValueChange={(v) => onChange({ ...draft, equipmentCategory: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={String(c.value)}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Division</Label>
            <Select value={draft.divisionCode} onValueChange={(v) => onChange({ ...draft, divisionCode: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select division" />
              </SelectTrigger>
              <SelectContent>
                {DIVISIONS.map((d) => (
                  <SelectItem key={d.code} value={String(d.code)}>
                    {d.code} — {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Details</Label>
          <Input
            value={draft.assetDetail}
            onChange={(e) => onChange({ ...draft, assetDetail: e.target.value })}
            placeholder="Optional description"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.asset.trim() || !draft.divisionCode}>
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type AssetSortColumn = 'asset' | 'category' | 'division' | 'details';

function sortAssets(rows: EquipmentAsset[], sort: SortState<AssetSortColumn>): EquipmentAsset[] {
  if (rows.length <= 1) return rows;

  const indexed = rows.map((asset) => ({
    asset,
    assetKey: asset.asset,
    categoryKey: categoryLabel(asset.equipmentCategory) || '',
    divisionKey: asset.divisionCode,
    detailsKey: asset.assetDetail || '',
  }));

  if (!sort.column) {
    indexed.sort((rowA, rowB) => rowA.assetKey.localeCompare(rowB.assetKey, undefined, { numeric: true }));
    return indexed.map((row) => row.asset);
  }

  const direction: SortDirection = sort.direction;
  indexed.sort((rowA, rowB) => {
    switch (sort.column) {
      case 'asset':
        return compareText(rowA.assetKey, rowB.assetKey, direction);
      case 'category':
        return compareText(rowA.categoryKey, rowB.categoryKey, direction);
      case 'division':
        return compareNumber(rowA.divisionKey, rowB.divisionKey, direction);
      case 'details':
        return compareText(rowA.detailsKey, rowB.detailsKey, direction);
      default:
        return 0;
    }
  });
  return indexed.map((row) => row.asset);
}

const AssetsTableHead = memo(function AssetsTableHead({
  sort,
  onSortColumn,
}: {
  sort: SortState<AssetSortColumn>;
  onSortColumn: (column: AssetSortColumn) => void;
}) {
  return (
    <thead>
      <tr className="border-b bg-muted/50 text-left">
        <SortableTableHeader column="asset" label="Asset" sort={sort} onSortColumn={onSortColumn} />
        <SortableTableHeader column="category" label="Category" sort={sort} onSortColumn={onSortColumn} className="hidden md:table-cell" />
        <SortableTableHeader column="division" label="Division" sort={sort} onSortColumn={onSortColumn} />
        <SortableTableHeader column="details" label="Details" sort={sort} onSortColumn={onSortColumn} className="hidden sm:table-cell" />
        <th className="w-24 px-3 py-2" />
      </tr>
    </thead>
  );
});

const AssetTableRow = memo(function AssetTableRow({
  asset,
  onEdit,
  onDeactivate,
}: {
  asset: EquipmentAsset;
  onEdit: (asset: EquipmentAsset) => void;
  onDeactivate: (asset: EquipmentAsset) => void;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 font-medium">{asset.asset}</td>
      <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{categoryLabel(asset.equipmentCategory) || '—'}</td>
      <td className="px-3 py-2">
        <Badge variant="outline">{divisionLabel(asset.divisionCode)}</Badge>
      </td>
      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{asset.assetDetail || '—'}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(asset)} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onDeactivate(asset)} title="Deactivate">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  );
});

function AssetsSection() {
  const { data: assets = [], isLoading } = useAllEquipmentAssets();
  const createMut = useCreateAsset();
  const updateMut = useUpdateAsset();
  const deactivateMut = useDeactivateAsset();

  const [sort, setSort] = useState<SortState<AssetSortColumn>>(EMPTY_SORT);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssetDraft>(emptyAssetDraft);
  const [deactivateTarget, setDeactivateTarget] = useState<EquipmentAsset | null>(null);

  const sortedAssets = useMemo(() => sortAssets(assets, sort), [assets, sort]);
  const handleSortColumn = useCallback((column: AssetSortColumn) => {
    setSort((current) => toggleSort(current, column));
  }, []);
  const requestDeactivate = useCallback((asset: EquipmentAsset) => setDeactivateTarget(asset), []);

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyAssetDraft);
  }

  const startEdit = useCallback((a: EquipmentAsset) => {
    setAdding(false);
    setEditingId(a.id);
    setDraft({
      asset: a.asset,
      assetDetail: a.assetDetail || '',
      divisionCode: a.divisionCode != null ? String(a.divisionCode) : '',
      equipmentCategory: a.equipmentCategory != null ? String(a.equipmentCategory) : '',
    });
  }, []);

  function cancel() {
    setAdding(false);
    setEditingId(null);
  }

  async function saveNew() {
    const divCode = Number(draft.divisionCode);
    try {
      await createMut.mutateAsync({
        asset: draft.asset.trim(),
        assetDetail: draft.assetDetail.trim() || undefined,
        divisionCode: divCode,
        divisionPicklist: picklistForCode(divCode),
        equipmentCategory: draft.equipmentCategory ? Number(draft.equipmentCategory) : undefined,
      });
      toast.success(`Asset ${draft.asset.trim()} created`);
      cancel();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    const divCode = Number(draft.divisionCode);
    try {
      await updateMut.mutateAsync({
        id: editingId,
        asset: draft.asset.trim(),
        assetDetail: draft.assetDetail.trim() || undefined,
        divisionCode: divCode,
        equipmentCategory: draft.equipmentCategory ? Number(draft.equipmentCategory) : undefined,
        divisionPicklist: picklistForCode(divCode),
      });
      toast.success(`Asset ${draft.asset.trim()} updated`);
      cancel();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeactivate(a: EquipmentAsset) {
    try {
      await deactivateMut.mutateAsync(a.id);
      toast.success(`Asset ${a.asset} deactivated`);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">
          Equipment Assets <Badge variant="secondary">{assets.length}</Badge>
        </h2>
        <Button size="sm" onClick={startAdd} disabled={adding} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {adding && (
        <div className="mb-4">
          <AssetForm draft={draft} onChange={setDraft} onSave={saveNew} onCancel={cancel} saving={createMut.isPending} title="New Asset" />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading assets…</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <AssetsTableHead sort={sort} onSortColumn={handleSortColumn} />
            <tbody>
              {sortedAssets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No assets found.
                  </td>
                </tr>
              )}
              {sortedAssets.map((a) =>
                editingId === a.id ? (
                  <tr key={a.id}>
                    <td colSpan={5} className="p-2">
                      <AssetForm
                        draft={draft}
                        onChange={setDraft}
                        onSave={saveEdit}
                        onCancel={cancel}
                        saving={updateMut.isPending}
                        title={`Edit ${a.asset}`}
                      />
                    </td>
                  </tr>
                ) : (
                  <AssetTableRow key={a.id} asset={a} onEdit={startEdit} onDeactivate={requestDeactivate} />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={deactivateTarget != null} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget?.asset}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the asset. It can be reactivated later in Dataverse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateTarget) void handleDeactivate(deactivateTarget);
                setDeactivateTarget(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Employee editor ─────────────────────────────────────────────────────────

type EmployeeDraft = { empNum: string; matchedLookup: LookupEmployee | null };
const emptyEmployeeDraft: EmployeeDraft = { empNum: '', matchedLookup: null };

function EmployeeForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  title,
  lookupEmployees,
}: {
  draft: EmployeeDraft;
  onChange: (d: EmployeeDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lookupEmployees: LookupEmployee[];
}) {
  const suggestions = useMemo(() => {
    const q = draft.empNum.trim();
    if (!q || draft.matchedLookup) return [];
    return lookupEmployees.filter((e) => String(e.empNum ?? '').includes(q)).slice(0, 8);
  }, [draft.empNum, draft.matchedLookup, lookupEmployees]);

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Employee Number</Label>
            <Input
              type="number"
              value={draft.empNum}
              onChange={(e) => {
                const val = e.target.value;
                const exact = lookupEmployees.find((emp) => String(emp.empNum) === val.trim());
                onChange({ empNum: val, matchedLookup: exact ?? null });
              }}
              placeholder="e.g. 1234"
            />
            {suggestions.length > 0 && (
              <div className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-popover text-sm shadow-md">
                {suggestions.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted"
                    onClick={() => onChange({ empNum: String(emp.empNum ?? ''), matchedLookup: emp })}
                  >
                    <span className="font-medium">{emp.empNum}</span>
                    <span className="text-muted-foreground">{formatEmployeeDisplayName(emp.name) || emp.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Employee Name</Label>
            <Input
              value={draft.matchedLookup ? formatEmployeeDisplayName(draft.matchedLookup.name) || draft.matchedLookup.name : ''}
              readOnly
              className={draft.matchedLookup ? 'font-semibold bg-muted' : 'bg-muted'}
              placeholder={draft.empNum ? 'No match found' : 'Auto-populated from employee number'}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.matchedLookup}>
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type EmployeeSortColumn = 'name' | 'empNum' | 'type';

function sortEmployees(rows: ShopEmployee[], sort: SortState<EmployeeSortColumn>): ShopEmployee[] {
  if (rows.length <= 1) return rows;

  const indexed = rows.map((employee) => ({
    employee,
    nameKey: shopEmployeeDisplayName(employee),
    empNumKey: employee.empNum,
    typeKey: MECHANIC_TYPE_ORDER.indexOf(employeeMechanicType(employee)),
  }));

  if (!sort.column) {
    indexed.sort((rowA, rowB) => {
      const typeOrder = rowA.typeKey - rowB.typeKey;
      if (typeOrder !== 0) return typeOrder;
      return rowA.nameKey.localeCompare(rowB.nameKey);
    });
    return indexed.map((row) => row.employee);
  }

  const direction: SortDirection = sort.direction;
  indexed.sort((rowA, rowB) => {
    switch (sort.column) {
      case 'name':
        return compareText(rowA.nameKey, rowB.nameKey, direction);
      case 'empNum':
        return compareNumber(rowA.empNumKey, rowB.empNumKey, direction);
      case 'type':
        return compareNumber(rowA.typeKey, rowB.typeKey, direction);
      default:
        return 0;
    }
  });
  return indexed.map((row) => row.employee);
}

const EmployeesTableHead = memo(function EmployeesTableHead({
  sort,
  onSortColumn,
}: {
  sort: SortState<EmployeeSortColumn>;
  onSortColumn: (column: EmployeeSortColumn) => void;
}) {
  return (
    <thead>
      <tr className="border-b bg-muted/50 text-left">
        <SortableTableHeader column="name" label="Employee Name" sort={sort} onSortColumn={onSortColumn} />
        <SortableTableHeader column="empNum" label="Emp #" sort={sort} onSortColumn={onSortColumn} />
        <SortableTableHeader column="type" label="Type" sort={sort} onSortColumn={onSortColumn} />
        <th className="w-16 px-3 py-2" />
      </tr>
    </thead>
  );
});

const EmployeeTableRow = memo(function EmployeeTableRow({
  employee,
  onDeactivate,
}: {
  employee: ShopEmployee;
  onDeactivate: (employee: ShopEmployee) => void;
}) {
  const type = employeeMechanicType(employee);
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 font-medium">{shopEmployeeDisplayName(employee)}</td>
      <td className="px-3 py-2">{employee.empNum ?? '—'}</td>
      <td className="px-3 py-2">
        <Badge variant={type === 'admin' ? 'default' : type === 'road' ? 'secondary' : 'outline'}>
          {employeeMechanicTypeLabel(employee)}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="icon-sm" onClick={() => onDeactivate(employee)} title="Deactivate">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  );
});

function EmployeesSection() {
  const { data: employees = [], isLoading } = useShopEmployeeList();
  const { data: lookupEmployees = [] } = useLookupEmployees();
  const createMut = useCreateShopEmployee();
  const deactivateMut = useDeactivateShopEmployee();

  const [sort, setSort] = useState<SortState<EmployeeSortColumn>>(EMPTY_SORT);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<EmployeeDraft>(emptyEmployeeDraft);
  const [deactivateTarget, setDeactivateTarget] = useState<ShopEmployee | null>(null);

  const sortedEmployees = useMemo(() => sortEmployees(employees, sort), [employees, sort]);
  const handleSortColumn = useCallback((column: EmployeeSortColumn) => {
    setSort((current) => toggleSort(current, column));
  }, []);
  const requestDeactivate = useCallback((employee: ShopEmployee) => setDeactivateTarget(employee), []);

  function startAdd() {
    setAdding(true);
    setDraft(emptyEmployeeDraft);
  }

  function cancel() {
    setAdding(false);
  }

  async function saveNew() {
    if (!draft.matchedLookup) return;
    try {
      await createMut.mutateAsync({
        autoNumber: draft.matchedLookup.name,
        empNum: draft.matchedLookup.empNum,
        employeeId: draft.matchedLookup.id,
      });
      toast.success(`Employee ${formatEmployeeDisplayName(draft.matchedLookup.name) || draft.matchedLookup.name} added`);
      cancel();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeactivate(e: ShopEmployee) {
    try {
      await deactivateMut.mutateAsync(e.id);
      toast.success(`Employee ${e.autoNumber || e.id} deactivated`);
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">
          Shop Employees <Badge variant="secondary">{employees.length}</Badge>
        </h2>
        <Button size="sm" onClick={startAdd} disabled={adding} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {adding && (
        <div className="mb-4">
          <EmployeeForm
            draft={draft}
            onChange={setDraft}
            onSave={saveNew}
            onCancel={cancel}
            saving={createMut.isPending}
            title="New Employee"
            lookupEmployees={lookupEmployees}
          />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading employees…</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <EmployeesTableHead sort={sort} onSortColumn={handleSortColumn} />
            <tbody>
              {sortedEmployees.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No employees found.
                  </td>
                </tr>
              )}
              {sortedEmployees.map((emp) => (
                <EmployeeTableRow key={emp.id} employee={emp} onDeactivate={requestDeactivate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={deactivateTarget != null} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget ? shopEmployeeDisplayName(deactivateTarget) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the shop employee record. It can be reactivated later in Dataverse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateTarget) void handleDeactivate(deactivateTarget);
                setDeactivateTarget(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'assets' | 'employees';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('assets');
  const { data: user, isLoading: userLoading } = useUser();

  if (userLoading || !user) {
    return <AccessCheckingCard message="Loading your Microsoft 365 identity." />;
  }

  if (!user.isManager) {
    return (
      <ManagerAccessDeniedCard
        user={user}
        message="Your Microsoft 365 account is not on the manager allowlist for editing assets and employees."
      />
    );
  }

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Edit Assets & Employees</h1>
          <p className="text-sm text-muted-foreground mt-1">Add, update, or deactivate equipment assets and shop employee records.</p>
        </div>

        <div className="mb-6 flex gap-1 rounded-lg bg-muted p-1 w-fit">
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === 'assets' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('assets')}
          >
            Assets
          </button>
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === 'employees' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('employees')}
          >
            Employees
          </button>
        </div>

        {tab === 'assets' ? <AssetsSection /> : <EmployeesSection />}
      </div>
    </main>
  );
}
