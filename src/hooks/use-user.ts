import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type AppUser = {
  email: string;
  name: string;
  userId: string;
  isManager: boolean;
  isKioskAccount: boolean;
  requiresEmployeeCode: boolean;
  canPunch: boolean;
  /** Work email linked on Employee — opens timecard without a kiosk code. */
  linkedPersonalLogin: boolean;
  shopEmployeeId?: string;
  isRoadMech?: boolean;
  isAdmin?: boolean;
  isPartsRunner?: boolean;
};

export const useUser = () => {
  return useQuery({
    queryKey: queryKeys.user(),
    queryFn: () => apiFetch<AppUser>('/api/me'),
  });
};
