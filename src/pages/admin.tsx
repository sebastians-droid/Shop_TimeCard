import { useMemo, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useAllEquipmentAssets, useCreateAsset, useUpdateAsset, useDeactivateAsset,
  useShopEmployeeList, useCreateShopEmployee, useUpdateShopEmployee, useDeactivateShopEmployee,
} from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';

const DIVISIONS = [
  { code: 101, picklist: 290180001, label: 'MILL. CLEAN UP' },
  { code: 200, picklist: 0, label: 'SHOP' },
  { code: 300, picklist: 4, label: 'MILL' },
  { code: 501, picklist: 9, label: 'HVE' },
  { code: 600, picklist: 8, label: 'GRIND' },
  { code: 700, picklist: 1, label: 'CON' },
  { code: 798, picklist: 7, label: 'FARM' },
  { code: 800, picklist: 3, label: 'S/S' },
  { code: 801, picklist: 5, label: 'VB S/S' },
  { code: 803, picklist: 2, label: 'BT' },
  { code: 900, picklist: 6, label: 'ADMIN' },
] as const;

function divisionLabel(code?: number) {
  if (code == null) return '';
  const d = DIVISIONS.find(d => d.code === code);
  return d ? `${d.code} ${d.label}` : String(code);
}

function picklistForCode(code: number) {
  return DIVISIONS.find(d => d.code === code)?.picklist;
}

// ─── Asset editor ────────────────────────────────────────────────────────────

type AssetDraft = { asset: string; assetDetail: string; divisionCode: string };
const emptyAssetDraft: AssetDraft = { asset: '', assetDetail: '', divisionCode: '' };

function AssetForm({ draft, onChange, onSave, onCancel, saving, title }: {
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
            <Input value={draft.asset} onChange={e => onChange({ ...draft, asset: e.target.value })} placeholder="e.g. PT500" />
          </div>
          <div>
            <Label>Details</Label>
            <Input value={draft.assetDetail} onChange={e => onChange({ ...draft, assetDetail: e.target.value })} placeholder="Optional description" />
          </div>
          <div>
            <Label>Division</Label>
            <Select value={draft.divisionCode} onValueChange={v => onChange({ ...draft, divisionCode: v })}>
              <SelectTrigger><SelectValue placeholder="Select division" /></SelectTrigger>
              <SelectContent>
                {DIVISIONS.map(d => (
                  <SelectItem key={d.code} value={String(d.code)}>{d.code} — {d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}><X className="h-4 w-4" /> Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.asset.trim() || !draft.divisionCode}>
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetsSection() {
  const { data: assets = [], isLoading } = useAllEquipmentAssets();
  const createMut = useCreateAsset();
  const updateMut = useUpdateAsset();
  const deactivateMut = useDeactivateAsset();

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssetDraft>(emptyAssetDraft);

  const filtered = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter(a =>
      a.asset.toLowerCase().includes(q) ||
      (a.assetDetail || '').toLowerCase().includes(q) ||
      divisionLabel(a.divisionCode).toLowerCase().includes(q)
    );
  }, [assets, search]);

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyAssetDraft);
  }

  function startEdit(a: EquipmentAsset) {
    setAdding(false);
    setEditingId(a.id);
    setDraft({ asset: a.asset, assetDetail: a.assetDetail || '', divisionCode: a.divisionCode != null ? String(a.divisionCode) : '' });
  }

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
        <h2 className="text-xl font-semibold">Equipment Assets <Badge variant="secondary">{assets.length}</Badge></h2>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search assets…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button size="sm" onClick={startAdd} disabled={adding}><Plus className="h-4 w-4" /> Add</Button>
        </div>
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
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Details</th>
                <th className="px-3 py-2 font-medium">Division</th>
                <th className="px-3 py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No assets found.</td></tr>
              )}
              {filtered.map(a => editingId === a.id ? (
                <tr key={a.id}>
                  <td colSpan={4} className="p-2">
                    <AssetForm draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancel} saving={updateMut.isPending} title={`Edit ${a.asset}`} />
                  </td>
                </tr>
              ) : (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{a.asset}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{a.assetDetail || '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{divisionLabel(a.divisionCode)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon-sm" onClick={() => startEdit(a)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" title="Deactivate">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate {a.asset}?</AlertDialogTitle>
                            <AlertDialogDescription>This will deactivate the asset. It can be reactivated later in Dataverse.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeactivate(a)}>Deactivate</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Employee editor ─────────────────────────────────────────────────────────

type EmployeeDraft = { autoNumber: string; empNum: string };
const emptyEmployeeDraft: EmployeeDraft = { autoNumber: '', empNum: '' };

function EmployeeForm({ draft, onChange, onSave, onCancel, saving, title }: {
  draft: EmployeeDraft;
  onChange: (d: EmployeeDraft) => void;
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Display Name</Label>
            <Input value={draft.autoNumber} onChange={e => onChange({ ...draft, autoNumber: e.target.value })} placeholder="Employee name or code" />
          </div>
          <div>
            <Label>Employee Number</Label>
            <Input type="number" value={draft.empNum} onChange={e => onChange({ ...draft, empNum: e.target.value })} placeholder="e.g. 1234" />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}><X className="h-4 w-4" /> Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.autoNumber.trim()}>
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeesSection() {
  const { data: employees = [], isLoading } = useShopEmployeeList();
  const createMut = useCreateShopEmployee();
  const updateMut = useUpdateShopEmployee();
  const deactivateMut = useDeactivateShopEmployee();

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmployeeDraft>(emptyEmployeeDraft);

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e =>
      (e.autoNumber || '').toLowerCase().includes(q) ||
      (e.employee?.name1 || '').toLowerCase().includes(q) ||
      String(e.empNum || '').includes(q)
    );
  }, [employees, search]);

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyEmployeeDraft);
  }

  function startEdit(e: ShopEmployee) {
    setAdding(false);
    setEditingId(e.id);
    setDraft({ autoNumber: e.autoNumber || '', empNum: e.empNum != null ? String(e.empNum) : '' });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
  }

  async function saveNew() {
    try {
      await createMut.mutateAsync({
        autoNumber: draft.autoNumber.trim(),
        empNum: draft.empNum ? Number(draft.empNum) : undefined,
      });
      toast.success(`Employee ${draft.autoNumber.trim()} created`);
      cancel();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      await updateMut.mutateAsync({
        id: editingId,
        autoNumber: draft.autoNumber.trim(),
        empNum: draft.empNum ? Number(draft.empNum) : undefined,
      });
      toast.success(`Employee ${draft.autoNumber.trim()} updated`);
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
        <h2 className="text-xl font-semibold">Shop Employees <Badge variant="secondary">{employees.length}</Badge></h2>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button size="sm" onClick={startAdd} disabled={adding}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </div>

      {adding && (
        <div className="mb-4">
          <EmployeeForm draft={draft} onChange={setDraft} onSave={saveNew} onCancel={cancel} saving={createMut.isPending} title="New Employee" />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading employees…</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Display Name</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Employee Name</th>
                <th className="px-3 py-2 font-medium">Emp #</th>
                <th className="px-3 py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No employees found.</td></tr>
              )}
              {filtered.map(emp => editingId === emp.id ? (
                <tr key={emp.id}>
                  <td colSpan={4} className="p-2">
                    <EmployeeForm draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancel} saving={updateMut.isPending} title={`Edit ${emp.autoNumber || 'Employee'}`} />
                  </td>
                </tr>
              ) : (
                <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{emp.autoNumber || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{emp.employee?.name1 || '—'}</td>
                  <td className="px-3 py-2">{emp.empNum ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon-sm" onClick={() => startEdit(emp)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" title="Deactivate">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate {emp.autoNumber || 'this employee'}?</AlertDialogTitle>
                            <AlertDialogDescription>This will deactivate the shop employee record. It can be reactivated later in Dataverse.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeactivate(emp)}>Deactivate</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'assets' | 'employees';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('assets');

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
