import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KioskSessionContext, useKioskSession } from '@/hooks/use-kiosk-session';
import { EMPLOYEE_CODE_NOT_FOUND, findEmployeeByCode } from '@/lib/entry-helpers';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { toast } from '@/lib/toast';

/** Shared kiosk routes. Leaving both of these clears the signed-in employee. */
const KIOSK_PATHS = ['/timecard', '/mechanic-log'];

/** No pointer, key, or scroll activity for this long returns the kiosk to the code screen. */
const KIOSK_IDLE_MS = 20_000;

export function KioskSessionProvider({ children }: { children: ReactNode }) {
  const [employeeId, setEmployeeId] = useState('');
  const { pathname } = useLocation();
  const onKioskRoute = KIOSK_PATHS.includes(pathname);

  // Drop the signed-in employee as soon as the kiosk routes are left, before paint.
  if (!onKioskRoute && employeeId) {
    setEmployeeId('');
  }

  const signIn = useCallback((nextEmployeeId: string) => {
    setEmployeeId(nextEmployeeId);
  }, []);

  const signOut = useCallback(() => {
    setEmployeeId('');
  }, []);

  useEffect(() => {
    if (!employeeId || !onKioskRoute) return;

    const signOutForIdle = () => {
      setEmployeeId('');
      toast.info(`Signed out after ${KIOSK_IDLE_MS / 1000} seconds of inactivity.`);
    };

    let timer = window.setTimeout(signOutForIdle, KIOSK_IDLE_MS);

    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(signOutForIdle, KIOSK_IDLE_MS);
    };

    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const eventName of events) window.addEventListener(eventName, reset, { passive: true });
    window.addEventListener('scroll', reset, { passive: true, capture: true });

    return () => {
      window.clearTimeout(timer);
      for (const eventName of events) window.removeEventListener(eventName, reset);
      window.removeEventListener('scroll', reset, { capture: true });
    };
  }, [employeeId, onKioskRoute]);

  const value = useMemo(() => ({ employeeId, signIn, signOut }), [employeeId, signIn, signOut]);

  return <KioskSessionContext.Provider value={value}>{children}</KioskSessionContext.Provider>;
}

const viewLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
  }`;

export function KioskSessionBar({
  employee,
  detail,
  actions,
  onLeave,
}: {
  employee: AppShopEmployee;
  detail: string;
  actions?: ReactNode;
  onLeave?: () => void;
}) {
  const { signOut } = useKioskSession();

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">{employee.employeeName}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Employee {employee.employeeCode} · {detail}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Timecard and mechanic log" className="flex rounded-md border border-border bg-muted p-0.5">
              <NavLink to="/timecard" className={viewLinkClassName}>
                Timecard
              </NavLink>
              <NavLink to="/mechanic-log" className={viewLinkClassName}>
                Mechanic Log
              </NavLink>
            </nav>
            {actions}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onLeave?.();
                signOut();
              }}
            >
              Back to sign-in
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

export function EmployeeCodeSignIn({
  id,
  employees,
  loading,
  failed,
  error,
  onRetry,
  submitLabel,
  onAccepted,
}: {
  id: string;
  employees: AppShopEmployee[];
  loading: boolean;
  failed: boolean;
  error: unknown;
  onRetry: () => void;
  submitLabel: string;
  onAccepted?: () => void;
}) {
  const { signIn } = useKioskSession();
  const [employeeCode, setEmployeeCode] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const matched = findEmployeeByCode(employees, employeeCode);
    if (!matched) {
      toast.error(EMPLOYEE_CODE_NOT_FOUND);
      return;
    }
    onAccepted?.();
    signIn(matched.id);
    setEmployeeCode('');
    toast.success(`Verified ${matched.employeeName}.`);
  };

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Clock className="h-5 w-5" /> Sign in
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="mx-auto grid max-w-sm gap-3" onSubmit={handleSubmit}>
          <Label htmlFor={id}>Employee code</Label>
          <Input
            id={id}
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]*"
            type="password"
            value={employeeCode}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmployeeCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="****"
          />
          {failed ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Could not load shop employees from Dataverse.</p>
              <p className="mt-1 break-words text-destructive/80">
                {error instanceof Error ? error.message : 'Grant the app user Read on Shop Employee, then retry.'}
              </p>
              <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : null}
          <Button className="h-12" type="submit" disabled={loading || failed || employeeCode.trim().length === 0}>
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
