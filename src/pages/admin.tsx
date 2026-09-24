import { useMemo, useState } from 'react';
import { Check, ChevronDown, LockKeyhole, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
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
  useShopEmployeeList, useCreateShopEmployee, useDeactivateShopEmployee,
  useLookupEmployees, type LookupEmployee,
} from '@/hooks/use-shop-data';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';
import { useUser } from '@/hooks/use-user';
import { DIVISIONS, EQUIPMENT_CATEGORIES, divisionLabel, picklistForCode, categoryLabel } from '@/lib/reference-data';

// ─── Asset editor ────────────────────────────────────────────────────────────

type AssetDraft = { asset: string; assetDetail: string; divisionCode: string; equipmentCategory: string };
const emptyAssetDraft: AssetDraft = { asset: '', assetDetail: '', divisionCode: '', equipmentCategory: '' };

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
            <Label>Equipment Category</Label>
            <Select value={draft.equipmentCategory} onValueChange={v => onChange({ ...draft, equipmentCategory: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {EQUIPMENT_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={String(c.value)}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        <div>
          <Label>Details</Label>
          <Input value={draft.assetDetail} onChange={e => onChange({ ...draft, assetDetail: e.target.value })} placeholder="Optional description" />
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
    setDraft({ asset: a.asset, assetDetail: a.assetDetail || '', divisionCode: a.divisionCode != null ? String(a.divisionCode) : '', equipmentCategory: a.equipmentCategory != null ? String(a.equipmentCategory) : '' });
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
                <th className="px-3 py-2 font-medium hidden md:table-cell">Category</th>
                <th className="px-3 py-2 font-medium">Division</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Details</th>
                <th className="px-3 py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No assets found.</td></tr>
              )}
              {filtered.map(a => editingId === a.id ? (
                <tr key={a.id}>
                  <td colSpan={5} className="p-2">
                    <AssetForm draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancel} saving={updateMut.isPending} title={`Edit ${a.asset}`} />
                  </td>
                </tr>
              ) : (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{a.asset}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{categoryLabel(a.equipmentCategory) || '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{divisionLabel(a.divisionCode)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{a.assetDetail || '—'}</td>
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

type EmployeeDraft = { empNum: string; matchedLookup: LookupEmployee | null };
const emptyEmployeeDraft: EmployeeDraft = { empNum: '', matchedLookup: null };

function EmployeeForm({ draft, onChange, onSave, onCancel, saving, title, lookupEmployees }: {
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
    return lookupEmployees.filter(e => String(e.empNum ?? '').includes(q)).slice(0, 8);
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
              onChange={e => {
                const val = e.target.value;
                const exact = lookupEmployees.find(emp => String(emp.empNum) === val.trim());
                onChange({ empNum: val, matchedLookup: exact ?? null });
              }}
              placeholder="e.g. 1234"
            />
            {suggestions.length > 0 && (
              <div className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-popover text-sm shadow-md">
                {suggestions.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted"
                    onClick={() => onChange({ empNum: String(emp.empNum ?? ''), matchedLookup: emp })}
                  >
                    <span className="font-medium">{emp.empNum}</span>
                    <span className="text-muted-foreground">{emp.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Employee Name</Label>
            <Input
              value={draft.matchedLookup?.name ?? ''}
              readOnly
              className={draft.matchedLookup ? 'font-semibold bg-muted' : 'bg-muted'}
              placeholder={draft.empNum ? 'No match found' : 'Auto-populated from employee number'}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}><X className="h-4 w-4" /> Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.matchedLookup}>
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeesSection() {
  const { data: employees = [], isLoading } = useShopEmployeeList();
  const { data: lookupEmployees = [] } = useLookupEmployees();
  const createMut = useCreateShopEmployee();
  const deactivateMut = useDeactivateShopEmployee();

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
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
      toast.success(`Employee ${draft.matchedLookup.name} added`);
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
          <EmployeeForm draft={draft} onChange={setDraft} onSave={saveNew} onCancel={cancel} saving={createMut.isPending} title="New Employee" lookupEmployees={lookupEmployees} />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading employees…</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Employee Name</th>
                <th className="px-3 py-2 font-medium">Emp #</th>
                <th className="px-3 py-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No employees found.</td></tr>
              )}
              {filtered.map(emp => (
                <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{emp.employee?.name1 || emp.autoNumber || '—'}</td>
                  <td className="px-3 py-2">{emp.empNum ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" title="Deactivate">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate {emp.employee?.name1 || emp.autoNumber || 'this employee'}?</AlertDialogTitle>
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
  const { data: user, isLoading: userLoading } = useUser();

  if (userLoading || !user) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-2xl"><LockKeyhole className="h-6 w-6" /> Checking access</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Loading your Microsoft 365 identity.</p></CardContent>
        </Card>
      </main>
    );
  }

  if (!user.isManager) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Card className="border-l-4 border-l-destructive bg-card text-card-foreground shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-2xl"><LockKeyhole className="h-6 w-6" /> Manager access required</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Your Microsoft 365 account is not on the manager allowlist for editing assets and employees.</p>
            <div className="rounded-lg bg-muted p-4 text-muted-foreground">
              <p className="text-sm">Signed in as</p>
              <p className="mt-1 font-semibold text-foreground">{user.name || 'Unknown user'}</p>
              <p className="text-sm">{user.email}</p>
            </div>
          </CardContent>
        </Card>
      </main>
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
