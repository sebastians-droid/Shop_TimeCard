import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { entryDistanceMiles } from '@/lib/geolocation';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

/** Distances beyond this many miles from the shop are highlighted as suspect. */
const NEARBY_MILES = 1;

function distanceBadge(label: string, miles: number) {
  return (
    <Badge variant={miles > NEARBY_MILES ? 'destructive' : 'secondary'} className="text-xs">
      {label}: {miles.toFixed(1)} mi
    </Badge>
  );
}

function entryDistances(entry: ShopTimeEntry) {
  return {
    clockIn: entryDistanceMiles(entry.clockInLat, entry.clockInLon),
    clockOut: entryDistanceMiles(entry.clockOutLat, entry.clockOutLon),
  };
}

/** Bare clock-in/clock-out distance badges, for inline badge rows. */
export function EntryDistanceBadges({ entry }: { entry: ShopTimeEntry }) {
  const { clockIn, clockOut } = entryDistances(entry);
  return (
    <>
      {clockIn != null ? distanceBadge('In', clockIn) : null}
      {clockOut != null ? distanceBadge('Out', clockOut) : null}
    </>
  );
}

/** Labeled distance field, omitted entirely when the entry has no coordinates. */
export function EntryDistanceField({ entry }: { entry: ShopTimeEntry }) {
  const { clockIn, clockOut } = entryDistances(entry);
  if (clockIn == null && clockOut == null) return null;
  return (
    <div className="space-y-2">
      <Label>Distance</Label>
      <div className="flex flex-wrap gap-1">
        <EntryDistanceBadges entry={entry} />
      </div>
    </div>
  );
}
