import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';

export type AppUser = {
  email: string;
  name: string;
  userId: string;
  isManager: boolean;
};

export const useUser = () => {
  return useQuery({
    queryKey: ['user'],
    queryFn: () => apiFetch<AppUser>('/api/me'),
  });
};
