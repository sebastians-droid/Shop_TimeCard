import { format } from 'date-fns';
import { Check, LogIn, Pencil, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntryDistanceBadges } from '@/components/manager/entry-distance-badges';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

type ClockInLineProps = {
  entry: ShopTimeEntry;
  isEditing: boolean;
  value: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * The arrival punch each clock-in creates, shown as one line instead of a job
 * card. It only records when the employee clocked in, so the clock-in time is
 * the one thing a manager edits here.
 */
export function ClockInLine({ entry, isEditing, value, isSaving, onChange, onStartEdit, onSave, onCancel }: ClockInLineProps) {
  const clockIn = entry.clockIn ? format(new Date(entry.clockIn), 'p') : '—';
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
            <span className="font-medium">Clocked in {clockIn}</span>
            {entry.clockOut ? null : <span className="text-muted-foreground"> · no job started yet</span>}
          </span>
          <EntryDistanceBadges entry={{ ...entry, clockOutLat: undefined, clockOutLon: undefined }} />
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={onStartEdit}>
            <Pencil className="mr-1 h-3 w-3" /> Edit clock-in
          </Button>
        </>
      )}
    </div>
  );
}
