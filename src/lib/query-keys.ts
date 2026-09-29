/**
 * Single source of truth for React Query cache keys.
 *
 * Keys are grouped by entity so that a mutation can invalidate a whole entity
 * by its root key while individual queries stay free to add parameters.
 */
export const queryKeys = {
  user: () => ['user'] as const,
  shopEmployees: () => ['shopEmployee-list'] as const,
  lookupEmployees: () => ['lookupEmployee-list'] as const,
  equipmentAssets: () => ['equipmentAsset-list'] as const,
  timeEntries: () => ['shopTimeEntry-list'] as const,
  /** Root key covering every date range, for invalidation after a write. */
  schedules: () => ['schedule-list'] as const,
  scheduleRange: (from?: string, to?: string) => ['schedule-list', from, to] as const,
} as const;
