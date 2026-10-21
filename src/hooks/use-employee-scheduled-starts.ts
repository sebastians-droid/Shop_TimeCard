import { useCallback, useEffect, useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { scheduleListQuery, useScheduleList } from '@/hooks/use-shop-data';
import { scheduledStartsByDay } from '@/lib/schedule-starts';
import { toast } from '@/lib/toast';
import { paysFromClockIn, scheduledStartFor, type EmployeePayProfile } from '@/lib/time-rules';

const dayStart = (dateKey: string) => `${dateKey}T00:00:00Z`;
const dayEnd = (dateKey: string) => `${dateKey}T23:59:59Z`;

/**
 * One employee's scheduled starts from the Mechanic Schedule, for every page
 * that calculates pay. Shop pay runs from the day's scheduled start, or from
 * clock-in when that is later; without the stored start a day falls back to
 * 7:00 and disagrees with the manager dashboard.
 */
export function useEmployeeScheduledStarts(
  employeeId: string | undefined,
  payProfile: EmployeePayProfile | undefined,
  fromKey: string | undefined,
  toKey: string | undefined,
) {
  const needed = Boolean(employeeId) && !paysFromClockIn(payProfile);
  const query = useScheduleList(fromKey ? dayStart(fromKey) : undefined, toKey ? dayEnd(toKey) : undefined, {
    employeeId,
    enabled: needed,
  });
  const byDay = useMemo(() => scheduledStartsByDay(query.data ?? [], employeeId), [query.data, employeeId]);

  useEffect(() => {
    if (!query.isError) return;
    const message = query.error instanceof Error ? query.error.message : 'Schedule list failed to load.';
    toast.error(`Could not load scheduled starts. Hours assume 7:00 AM until this succeeds. ${message}`);
  }, [query.isError, query.error]);

  const payStartFor = useCallback((dateKey: string) => scheduledStartFor(payProfile, byDay.get(dateKey)), [byDay, payProfile]);

  return { payStartFor, failed: query.isError, error: query.error, refetch: query.refetch };
}

/**
 * The pay start for one employee-day, fetched on demand for saves that write
 * stored hours. Throws when the schedule can't be read, so a save never
 * silently stores hours computed from the wrong start.
 */
export async function fetchPayStart(
  queryClient: QueryClient,
  employeeId: string,
  payProfile: EmployeePayProfile | undefined,
  dateKey: string,
): Promise<string | null | undefined> {
  if (paysFromClockIn(payProfile)) return scheduledStartFor(payProfile);
  try {
    const rows = await queryClient.fetchQuery(scheduleListQuery(dayStart(dateKey), dayEnd(dateKey), employeeId));
    return scheduledStartFor(payProfile, scheduledStartsByDay(rows, employeeId).get(dateKey));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Schedule list failed to load.';
    throw new Error(`Could not load the scheduled start for ${dateKey}, so hours were not saved. ${message}`, { cause: error });
  }
}
