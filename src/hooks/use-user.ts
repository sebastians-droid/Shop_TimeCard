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
  shopEmployeeId?: string;
  isRoadMech?: boolean;
};

export const useUser = () => {
  return useQuery({
    queryKey: queryKeys.user(),
    queryFn: () => apiFetch<AppUser>('/api/me'),
  });
};
