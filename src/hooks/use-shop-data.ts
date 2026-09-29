import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.timeEntries() });
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
    mutationFn: ({
      id,
      ...fields
    }: { id: string } & Partial<EquipmentAsset> & { divisionPicklist?: number; equipmentCategory?: number }) =>
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

export function useUpsertSchedule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (record: {
      scheduleKey: string;
      employeeId: string;
      scheduleDate: string;
      scheduledStart?: string;
      onCall?: boolean;
    }) =>
      apiFetch<MechanicScheduleRow>('/api/schedules', {
        method: 'PATCH',
        body: JSON.stringify(record),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.schedules() });
    },
  });
}
