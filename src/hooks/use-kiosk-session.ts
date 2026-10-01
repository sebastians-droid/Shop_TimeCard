import { createContext, useContext } from 'react';

export type KioskSessionValue = {
  employeeId: string;
  signIn: (employeeId: string) => void;
  signOut: () => void;
};

export const KioskSessionContext = createContext<KioskSessionValue | undefined>(undefined);

export function useKioskSession() {
  const value = useContext(KioskSessionContext);
  if (!value) throw new Error('useKioskSession must be used within KioskSessionProvider');
  return value;
}
