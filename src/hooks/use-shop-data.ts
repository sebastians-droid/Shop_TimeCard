import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';

import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

export function useShopEmployeeList() {
  return useQuery({
    queryKey: queryKeys.shopEmployees(),
    queryFn: async () => {
      const data = await apiFetch<{ employees: ShopEmployee[] }>('/api/employees');
      return data.employees;
    },
  });
}

export type LookupEmployee = { id: string; name: string; empNum?: number };

export function useLookupEmployees() {
  return useQuery({
    queryKey: queryKeys.lookupEmployees(),
    queryFn: async () => {
      const data = await apiFetch<{ employees: LookupEmployee[] }>('/api/lookup-employees');
      return data.employees;
    },
  });
}

export function useAllEquipmentAssets() {
  return useQuery({
    queryKey: queryKeys.equipmentAssets(),
    queryFn: async () => {
      const data = await apiFetch<{ assets: EquipmentAsset[] }>('/api/assets');
      return data.assets;
    },
  });
}

export function useShopTimeEntryList() {
  return useQuery({
    queryKey: queryKeys.timeEntries(),
    queryFn: async () => {
      const data = await apiFetch<{ entries: ShopTimeEntry[] }>('/api/time-entries');
      return data.entries;
    },
  });
}

export function useCreateShopTimeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (record: Omit<ShopTimeEntry, 'id'>) =>
      apiFetch<ShopTimeEntry>('/api/time-entries', {
        method: 'POST',
        body: JSON.stringify(record),
      }),
    onSuccess: (created) => {
      client.setQueryData<ShopTimeEntry[]>(queryKeys.timeEntries(), (current) => {
        const rows = current ?? [];
        if (rows.some((row) => row.id === created.id)) return rows;
        return [created, ...rows];
      });
      void client.invalidateQueries({ queryKey: queryKeys.timeEntries() });
    },
  });
}

export function useUpdateShopTimeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changedFields }: { id: string; changedFields: Partial<Omit<ShopTimeEntry, 'id'>> }) =>
      apiFetch<ShopTimeEntry>(`/api/time-entries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(changedFields),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.timeEntries() });
    },
  });
}

export function useDeleteShopTimeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.timeEntries() });
    },
  });
}

export function useCreateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (record: Omit<EquipmentAsset, 'id'> & { divisionPicklist?: number; equipmentCategory?: number }) =>
      apiFetch<EquipmentAsset>('/api/assets', {
        method: 'POST',
        body: JSON.stringify(record),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.equipmentAssets() });
    },
  });
}

export function useUpdateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: { id: string } & Partial<EquipmentAsset> & { divisionPicklist?: number; equipmentCategory?: number }) =>
      apiFetch<EquipmentAsset>(`/api/assets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.equipmentAssets() });
    },
  });
}

export function useDeactivateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.equipmentAssets() });
    },
  });
}

export function useCreateShopEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (record: { autoNumber: string; empNum?: number; employeeId?: string }) =>
      apiFetch<ShopEmployee>('/api/employees', {
        method: 'POST',
        body: JSON.stringify(record),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.shopEmployees() });
      // A new shop employee consumes a lookup record, so the picker must refresh too.
      client.invalidateQueries({ queryKey: queryKeys.lookupEmployees() });
    },
  });
}

export type RoadMechanicUpdate = { id: string; isRoadMech: boolean };

export function useSetRoadMechanic() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isRoadMech }: RoadMechanicUpdate) =>
      apiFetch<ShopEmployee>(`/api/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRoadMech }),
      }),
    // Move the card to the other column immediately so the drop looks like it
    // landed; onError puts it back if the server refuses.
    onMutate: async ({ id, isRoadMech }) => {
      await client.cancelQueries({ queryKey: queryKeys.shopEmployees() });
      const previous = client.getQueryData<ShopEmployee[]>(queryKeys.shopEmployees());
      client.setQueryData<ShopEmployee[]>(queryKeys.shopEmployees(), (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, isRoadMech } : row)),
      );
      return { previous };
    },
    onError: (error, _record, context) => {
      if (context?.previous) client.setQueryData(queryKeys.shopEmployees(), context.previous);
      toast.error(error instanceof Error ? error.message : 'Unable to change the mechanic type.');
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.shopEmployees() });
    },
  });
}

export function useDeactivateShopEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/employees/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.shopEmployees() });
      client.invalidateQueries({ queryKey: queryKeys.lookupEmployees() });
    },
  });
}

export type MechanicScheduleRow = {
  id: string;
  scheduleKey: string;
  scheduleDate: string;
  scheduledStart?: string;
  onCall: boolean;
  employeeId?: string;
};

export function useScheduleList(from?: string, to?: string) {
  return useQuery({
    queryKey: queryKeys.scheduleRange(from, to),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const data = await apiFetch<{ schedules: MechanicScheduleRow[] }>(`/api/schedules?${params}`);
      return data.schedules;
    },
    enabled: Boolean(from && to),
  });
}

export type ScheduleUpsert = {
  scheduleKey: string;
  employeeId: string;
  scheduleDate: string;
  scheduledStart?: string;
  onCall?: boolean;
};

const sameScheduleSlot = (row: MechanicScheduleRow, record: ScheduleUpsert) =>
  row.employeeId === record.employeeId && row.scheduleDate.slice(0, 10) === record.scheduleDate.slice(0, 10);

export function useUpsertSchedule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (record: ScheduleUpsert) =>
      apiFetch<MechanicScheduleRow>('/api/schedules', {
        method: 'PATCH',
        body: JSON.stringify(record),
      }),
    // Write into every cached date range up front so the edited field holds its
    // new value instead of snapping back while the request is in flight.
    onMutate: async (record) => {
      await client.cancelQueries({ queryKey: queryKeys.schedules() });
      const previous = client.getQueriesData<MechanicScheduleRow[]>({ queryKey: queryKeys.schedules() });
      client.setQueriesData<MechanicScheduleRow[]>({ queryKey: queryKeys.schedules() }, (rows) => {
        if (!rows) return rows;
        const index = rows.findIndex((row) => sameScheduleSlot(row, record));
        if (index === -1) {
          return [
            ...rows,
            {
              id: `pending-${record.scheduleKey}`,
              scheduleKey: record.scheduleKey,
              scheduleDate: record.scheduleDate,
              scheduledStart: record.scheduledStart,
              onCall: record.onCall ?? false,
              employeeId: record.employeeId,
            },
          ];
        }
        const next = rows.slice();
        next[index] = {
          ...rows[index],
          scheduledStart: record.scheduledStart ?? rows[index].scheduledStart,
          onCall: record.onCall ?? rows[index].onCall,
        };
        return next;
      });
      return { previous };
    },
    onError: (error, _record, context) => {
      for (const [key, rows] of context?.previous ?? []) {
        client.setQueryData(key, rows);
      }
      toast.error(error instanceof Error ? error.message : 'Unable to save the schedule.');
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.schedules() });
    },
  });
}
