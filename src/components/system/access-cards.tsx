import { LockKeyhole } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppUser } from '@/hooks/use-user';

/** Shown while the signed-in identity is still loading. */
export function AccessCheckingCard({ title = 'Checking access', message }: { title?: string; message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <Card className="border-l-4 border-l-primary bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <LockKeyhole className="h-6 w-6" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}

/** Shown when a signed-in user is not on the manager allowlist. */
export function ManagerAccessDeniedCard({
  user,
  message,
  showAllowlistHint = false,
}: {
  user: AppUser;
  message: string;
  showAllowlistHint?: boolean;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <Card className="border-l-4 border-l-destructive bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <LockKeyhole className="h-6 w-6" /> Manager access required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="rounded-lg bg-muted p-4 text-muted-foreground">
            <p className="text-sm">Signed in as</p>
            <p className="mt-1 font-semibold text-foreground">{user.name || 'Unknown user'}</p>
            <p className="text-sm">{user.email}</p>
          </div>
          {showAllowlistHint ? (
            <p className="text-sm text-muted-foreground">
              Ask the app owner to add this email to the{' '}
              <span className="font-medium text-foreground">MANAGER_EMAILS</span> Function App setting.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
