import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { JobTimeLocks } from '@/lib/day-session';

type JobTimeFieldsProps = {
  entryId: string;
  locks: JobTimeLocks;
  running: boolean;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  /** Enter commits the edit, Escape abandons it. */
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
};

/**
 * A job's start and end. The day's clock-in and clock-out never move here; a
 * changed time is absorbed by the neighboring job.
 */
export function JobTimeFields({
  entryId,
  locks,
  running,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  onCommit,
  onCancel,
  disabled = false,
}: JobTimeFieldsProps) {
  const timeKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      onCommit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`edit-start-${entryId}`}>Started</Label>
          <Input
            id={`edit-start-${entryId}`}
            type="time"
            className="bg-background"
            value={startValue}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onStartChange(event.target.value)}
            onKeyDown={timeKeys}
            disabled={locks.startLocked || disabled}
          />
          {locks.startLocked ? <p className="text-xs text-muted-foreground">This is your clock-in, so it can't move.</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`edit-end-${entryId}`}>Ended</Label>
          <Input
            id={`edit-end-${entryId}`}
            type="time"
            className="bg-background"
            value={endValue}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onEndChange(event.target.value)}
            onKeyDown={timeKeys}
            disabled={locks.endLocked || disabled}
          />
          {running ? (
            <p className="text-xs text-muted-foreground">Still running. It ends when you switch jobs or clock out.</p>
          ) : locks.endLocked ? (
            <p className="text-xs text-muted-foreground">This is your clock-out, so it can't move.</p>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        The job next to this one gives up or takes the difference. Your clock-in and clock-out stay the same.
      </p>
    </div>
  );
}
