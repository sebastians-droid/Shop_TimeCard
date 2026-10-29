import { format } from 'date-fns';
import { Check, LogIn, Pencil, Trash2, X } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntryDistanceBadges } from '@/components/manager/entry-distance-badges';
import { entryWorkDateKey, formatDuration, getRawDurationMinutes } from '@/lib/time-rules';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

type ClockInLineProps = {
  entry: ShopTimeEntry;
  employeeName: string;
  isEditing: boolean;
  value: string;
  isSaving: boolean;
  isDeleting: boolean;
  onChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

const dayKey = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');
const dayLabel = (iso: string) => format(new Date(iso), 'EEE, MMM d');

/**
 * "4:30 PM – 5:15 PM" when the punch sits on its work day. Otherwise the dates
 * are spelled out, "Wed, Oct 28 4:30 PM – Thu, Oct 29 5:32 AM", because a row
 * filed under one day can hold times from the next.
 */
function punchSpan(entry: ShopTimeEntry) {
  if (!entry.clockIn) return '—';
  const workDay = entryWorkDateKey(entry);
  const clockIn = format(new Date(entry.clockIn), 'p');
  const clockOut = entry.clockOut ? format(new Date(entry.clockOut), 'p') : undefined;
  const offDay = dayKey(entry.clockIn) !== workDay || (entry.clockOut !== undefined && dayKey(entry.clockOut) !== workDay);
  if (!offDay) return clockOut ? `${clockIn} – ${clockOut}` : clockIn;
  if (!entry.clockOut || !clockOut) return `${dayLabel(entry.clockIn)} ${clockIn}`;
  if (dayKey(entry.clockIn) === dayKey(entry.clockOut)) return `${dayLabel(entry.clockIn)} ${clockIn} – ${clockOut}`;
  return `${dayLabel(entry.clockIn)} ${clockIn} – ${dayLabel(entry.clockOut)} ${clockOut}`;
}

/**
 * The arrival punch each clock-in creates, shown as one line instead of a job
 * card. It only records when the employee clocked in, so the clock-in time is
 * the one thing a manager edits here. A stray punch can be deleted outright.
 */
export function ClockInLine({
  entry,
  employeeName,
  isEditing,
  value,
  isSaving,
  isDeleting,
  onChange,
  onStartEdit,
  onSave,
  onCancel,
  onDelete,
}: ClockInLineProps) {
  const span = punchSpan(entry);
  const minutes = entry.clockOut ? getRawDurationMinutes(entry) : 0;
  const inputId = `clock-in-line-${entry.id}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 text-sm">
      <LogIn className="h-4 w-4 text-muted-foreground" aria-hidden />
      {isEditing ? (
        <>
          <label htmlFor={inputId} className="font-medium">
            Clocked in at
          </label>
          <Input
            id={inputId}
            type="time"
            className="h-8 w-32 bg-background"
            value={value}
            autoFocus
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
          <Button type="button" size="icon" className="h-8 w-8" aria-label="Save clock-in time" onClick={onSave} disabled={isSaving}>
            <Check className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Cancel clock-in edit" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          <span>
            <span className="font-medium">Clocked in {span}</span>
            {entry.clockOut ? (
              minutes >= 5 ? (
                <span className="text-muted-foreground"> · {formatDuration(minutes)} with no job</span>
              ) : null
            ) : (
              <span className="text-muted-foreground"> · no job started yet</span>
            )}
          </span>
          <EntryDistanceBadges entry={{ ...entry, clockOutLat: undefined, clockOutLon: undefined }} />
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onStartEdit}>
              <Pencil className="mr-1 h-3 w-3" /> Edit clock-in
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm" className="h-7 px-2" disabled={isDeleting}>
                  <Trash2 className="mr-1 h-3 w-3" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this clock-in?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes {employeeName}&apos;s unassigned punch ({span}) from Dataverse and the weekly timecard export.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete clock-in</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </div>
  );
}
