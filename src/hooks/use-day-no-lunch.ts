import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { applyNoLunchMarker, isPtoEntry, keepAutoClockOutMarker } from '@/lib/time-rules';
import { toast } from '@/lib/toast';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

/**
 * The day-level "No lunch" override, shared by employees and managers. It is
 * stored as a marker on every labor entry of the day.
 */
export function useDayNoLunch() {
  const queryClient = useQueryClient();
  const [lunchUpdatingKey, setLunchUpdatingKey] = useState('');

  /**
   * These writes deliberately bypass `useUpdateShopTimeEntry` and patch
   * directly: that mutation invalidates the entry list on each success, which
   * would fight the optimistic cache update partway through the loop. Instead
   * the cache is patched once up front and invalidated once at the end.
   */
  const setDayNoLunch = async ({
    entries,
    checked,
    updatingKey,
    employeeName,
    dayLabel,
  }: {
    entries: ShopTimeEntry[];
    checked: boolean;
    updatingKey: string;
    employeeName: string;
    /** "Oct 29", added to the confirmation so it names the day that changed. */
    dayLabel?: string;
  }): Promise<void> => {
    const laborEntries = entries.filter((entry: ShopTimeEntry) => !isPtoEntry(entry));
    if (laborEntries.length === 0) {
      toast.info('Clock in for this day first, then lunch can be overridden.');
      return;
    }

    const entryIds = new Set(laborEntries.map((entry: ShopTimeEntry) => entry.id));
    const previousEntries = queryClient.getQueryData<ShopTimeEntry[]>(queryKeys.timeEntries());

    queryClient.setQueryData<ShopTimeEntry[]>(queryKeys.timeEntries(), (current) =>
      (current ?? []).map((entry: ShopTimeEntry) =>
        entryIds.has(entry.id) ? { ...entry, notes: keepAutoClockOutMarker(entry.notes, applyNoLunchMarker(entry.notes, checked)) } : entry,
      ),
    );

    setLunchUpdatingKey(updatingKey);
    const onDay = dayLabel ? ` on ${dayLabel}` : '';
    try {
      for (const entry of laborEntries) {
        await apiFetch<ShopTimeEntry>(`/api/time-entries/${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: keepAutoClockOutMarker(entry.notes, applyNoLunchMarker(entry.notes, checked)) }),
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.timeEntries() });
      toast.success(checked ? `No lunch saved for ${employeeName}${onDay}.` : `Lunch deduction restored for ${employeeName}${onDay}.`);
    } catch (error: unknown) {
      if (previousEntries) {
        queryClient.setQueryData(queryKeys.timeEntries(), previousEntries);
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.timeEntries() });
      }
      toast.error(error instanceof Error ? error.message : 'Unable to update lunch setting.');
    } finally {
      setLunchUpdatingKey('');
    }
  };

  return { setDayNoLunch, lunchUpdatingKey };
}
