import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

import { apiFetch } from '@/lib/api';
import { planHoursRefresh, planJobTimeEdit, type JobTimeWrite } from '@/lib/day-session';
import { formatTimeForInput, timeAfter, timeOnWorkDay } from '@/lib/entry-helpers';
import { queryKeys } from '@/lib/query-keys';
import { AWAITING_ASSET_LABEL, type EmployeePayProfile } from '@/lib/time-rules';
import { toast } from '@/lib/toast';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

type JobDetails = Pick<ShopTimeEntry, 'timeEntry' | 'asset' | 'assetDivision' | 'division' | 'jobNumber' | 'notes'>;

async function runWrites(writes: JobTimeWrite[]) {
  for (const write of writes) {
    if (write.kind === 'delete') {
      await apiFetch<void>(`/api/time-entries/${write.id}`, { method: 'DELETE' });
    } else {
      await apiFetch<ShopTimeEntry>(`/api/time-entries/${write.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ clockIn: write.clockIn, clockOut: write.clockOut, hours: write.hours }),
      });
    }
  }
}

/**
 * Road mechanic Mechanic Log writes: moving a job's start and end, and
 * cancelling a job into unassigned time. Both update the cached day at once,
 * restore it if the server refuses, and reload once at the end.
 */
export function useRoadMechJobEdits(payStartFor: (dateKey: string) => string | null | undefined, payProfile: EmployeePayProfile) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const replaceDayInCache = async (dayEntries: ShopTimeEntry[], dayAfter: ShopTimeEntry[]) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.timeEntries() });
    const previous = queryClient.getQueryData<ShopTimeEntry[]>(queryKeys.timeEntries());
    const afterById = new Map(dayAfter.map((row) => [row.id, row]));
    const dayIds = new Set(dayEntries.map((row) => row.id));
    queryClient.setQueryData<ShopTimeEntry[]>(queryKeys.timeEntries(), (rows) =>
      rows?.flatMap((row) => {
        if (!dayIds.has(row.id)) return [row];
        const next = afterById.get(row.id);
        return next ? [next] : [];
      }),
    );
    return previous;
  };

  /** True when either typed time differs from what is stored. */
  const timesChanged = (entry: ShopTimeEntry, startValue: string, endValue: string) =>
    (Boolean(entry.clockIn) && startValue !== formatTimeForInput(entry.clockIn!)) ||
    (Boolean(entry.clockOut) && endValue !== formatTimeForInput(entry.clockOut!));

  /** Saves new times plus the job's details. Returns false when nothing was written. */
  const saveJobTimes = async ({
    entry,
    day,
    dayEntries,
    startValue,
    endValue,
    details,
    label,
  }: {
    entry: ShopTimeEntry;
    day: Date;
    dayEntries: ShopTimeEntry[];
    startValue: string;
    endValue: string;
    details: JobDetails;
    label: string;
  }): Promise<boolean> => {
    if (!startValue || (entry.clockOut && !endValue)) {
      toast.error('Enter the start and end time for this job.');
      return false;
    }
    const startChanged = startValue !== formatTimeForInput(entry.clockIn!);
    const endChanged = Boolean(entry.clockOut) && endValue !== formatTimeForInput(entry.clockOut!);
    const startedAt = startChanged ? timeOnWorkDay(day, startValue, dayEntries) : entry.clockIn!;
    const endedAt = entry.clockOut ? (endChanged ? timeAfter(startedAt, endValue) : entry.clockOut) : undefined;
    const plan = planJobTimeEdit(dayEntries, entry.id, startedAt, endedAt, payStartFor(format(day, 'yyyy-MM-dd')), payProfile);
    if ('error' in plan) {
      toast.error(plan.error);
      return false;
    }
    const previous = await replaceDayInCache(
      dayEntries,
      plan.dayAfter.map((row) => (row.id === entry.id ? { ...row, ...details } : row)),
    );
    setSaving(true);
    try {
      await runWrites(plan.writes);
      await apiFetch<ShopTimeEntry>(`/api/time-entries/${entry.id}`, { method: 'PATCH', body: JSON.stringify(details) });
      const moved = plan.shiftedIds.length;
      const absorbed = plan.removedIds.length;
      const extras = [
        moved ? `${moved} neighboring ${moved === 1 ? 'job' : 'jobs'} adjusted` : '',
        absorbed ? `${absorbed} unassigned ${absorbed === 1 ? 'block' : 'blocks'} absorbed` : '',
      ].filter(Boolean);
      const range = `${format(new Date(startedAt), 'p')} – ${endedAt ? format(new Date(endedAt), 'p') : 'now'}`;
      toast.success(`${label} on ${format(day, 'MMM d')} now runs ${range}.${extras.length ? ` ${extras.join(', ')}.` : ''}`);
    } catch (error: unknown) {
      if (previous) queryClient.setQueryData(queryKeys.timeEntries(), previous);
      const message = error instanceof Error ? error.message : 'Unable to change the job times.';
      toast.error(`${message} The log was reloaded to show what saved.`);
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.timeEntries() });
      setSaving(false);
    }
    return true;
  };

  /** Turns a finished job into unassigned time. The day's hours and the neighbors' times stay put. */
  const cancelJob = async ({
    entry,
    day,
    dayEntries,
    employeeName,
    label,
  }: {
    entry: ShopTimeEntry;
    day: Date;
    dayEntries: ShopTimeEntry[];
    employeeName: string;
    label: string;
  }) => {
    const span = `${format(new Date(entry.clockIn!), 'p')} – ${format(new Date(entry.clockOut!), 'p')}`;
    const unassigned: ShopTimeEntry = {
      ...entry,
      timeEntry: `${employeeName} - ${AWAITING_ASSET_LABEL}`,
      asset: undefined,
      assetDivision: undefined,
      division: undefined,
      jobNumber: undefined,
    };
    const dayAfter = dayEntries.map((row) => (row.id === entry.id ? unassigned : row));
    const previous = await replaceDayInCache(dayEntries, dayAfter);
    setSaving(true);
    try {
      await apiFetch<ShopTimeEntry>(`/api/time-entries/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ timeEntry: unassigned.timeEntry, asset: null, assetDivision: null, division: null, jobNumber: '' }),
      });
      await runWrites(planHoursRefresh(dayAfter, payStartFor(format(day, 'yyyy-MM-dd')), payProfile));
      toast.success(
        `Cancelled ${label} on ${format(day, 'MMM d')} (${span}). That time is now unassigned — assign it a job or stretch a neighboring job over it.`,
      );
    } catch (error: unknown) {
      if (previous) queryClient.setQueryData(queryKeys.timeEntries(), previous);
      toast.error(error instanceof Error ? error.message : 'Unable to cancel the job.');
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.timeEntries() });
      setSaving(false);
    }
  };

  return { saving, timesChanged, saveJobTimes, cancelJob };
}
