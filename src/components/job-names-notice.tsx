import { Button } from '@/components/ui/button';

type JobNamesNoticeProps = {
  error: unknown;
  onRetry: () => void;
};

/** The name of the job typed into a job number field, once it matches one. */
export function JobNameHint({ jobNumber, jobNames }: { jobNumber: string; jobNames: Map<string, string> }) {
  const name = jobNames.get(jobNumber.trim().toLowerCase());
  return name ? <p className="text-xs text-muted-foreground">{name}</p> : null;
}

/** Shown when the job list fails to load, so bare job numbers aren't mistaken for jobs without names. */
export function JobNamesNotice({ error, onRetry }: JobNamesNoticeProps) {
  const message = error instanceof Error ? error.message : 'The job list failed to load.';
  const missingPrivilege = message.includes('prvReadswank_Job');
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        Job names are unavailable, so only job numbers are shown.{' '}
        {missingPrivilege ? 'Add Read on Job to the Shop Timecard API security role.' : message}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
