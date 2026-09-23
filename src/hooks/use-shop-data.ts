import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopEmployee } from '@/models/shop-employee';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

export function useShopEmployeeList(_options?: unknown) {
  return useQuery({
    queryKey: ['shopEmployee-list'],
    queryFn: async () => {
      const data = await apiFetch<{ employees: ShopEmployee[] }>('/api/employees');
      return data.employees;
    },
  });
}

export type LookupEmployee = { id: string; name: string; empNum?: number };

export function useLookupEmployees() {
  return useQuery({
    queryKey: ['lookupEmployee-list'],
    queryFn: async () => {
      const data = await apiFetch<{ employees: LookupEmployee[] }>('/api/lookup-employees');
      return data.employees;
    },
  });
}

export function useAllEquipmentAssets() {
  return useQuery({
    queryKey: ['equipmentAsset-list', 'all-assets'],
    queryFn: async () => {
      const data = await apiFetch<{ assets: EquipmentAsset[] }>('/api/assets');
      return data.assets;
    },
  });
}

export function useShopTimeEntryList(_options?: unknown) {
  return useQuery({
    queryKey: ['shopTimeEntry-list'],
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
      client.invalidateQueries({ queryKey: ['shopTimeEntry-list'] });
    },
  });
}

export function useUpdateShopTimeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changedFields,
    }: {
      id: string;
      changedFields: Partial<Omit<ShopTimeEntry, 'id'>>;
    }) =>
      apiFetch<ShopTimeEntry>(`/api/time-entries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(changedFields),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['shopTimeEntry-list'] });
    },
  });
}

export function useDeleteShopTimeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['shopTimeEntry-list'] });
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
      client.invalidateQueries({ queryKey: ['equipmentAsset-list'] });
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
      client.invalidateQueries({ queryKey: ['equipmentAsset-list'] });
    },
  });
}

export function useDeactivateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['equipmentAsset-list'] });
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
      client.invalidateQueries({ queryKey: ['shopEmployee-list'] });
    },
  });
}

export function useUpdateShopEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: { id: string; autoNumber?: string; empNum?: number; employeeId?: string }) =>
      apiFetch<ShopEmployee>(`/api/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['shopEmployee-list'] });
    },
  });
}

export function useDeactivateShopEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/employees/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['shopEmployee-list'] });
    },
  });
}
