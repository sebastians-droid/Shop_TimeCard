import { useEffect, useMemo, useState } from 'react';
import { format, startOfDay } from 'date-fns';
import { CalendarIcon, ChevronDown, MapPin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PunchMapCanvas } from '@/components/manager/punch-map-canvas';
import { toast } from '@/lib/toast';
import { buildDayPunches, locatedPunchDates } from '@/lib/punch-map';
import type { AppShopEmployee } from '@/lib/shop-employees';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

const ALL_EMPLOYEES = 'all';
const NEARBY_MILES = 1;

type PunchMapProps = {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  timeEntries: ShopTimeEntry[];
  employees: AppShopEmployee[];
  assets: EquipmentAsset[];
  isLoading: boolean;
  loadError?: string;
};

export function PunchMap({ selectedDate, onSelectDate, timeEntries, employees, assets, isLoading, loadError }: PunchMapProps) {
  const dayKey = format(selectedDate, 'yyyy-MM-dd');
  const [employeeFilter, setEmployeeFilter] = useState(ALL_EMPLOYEES);
  const [selectedPinId, setSelectedPinId] = useState('');
  const [filterDayKey, setFilterDayKey] = useState(dayKey);
  const [calendarOpen, setCalendarOpen] = useState(false);

  if (filterDayKey !== dayKey) {
    setFilterDayKey(dayKey);
    setEmployeeFilter(ALL_EMPLOYEES);
    setSelectedPinId('');
  }

  useEffect(() => {
    if (loadError) toast.error(`Could not load punch locations. ${loadError}`);
  }, [loadError]);

  const dayPunches = useMemo(() => buildDayPunches(timeEntries, employees, assets, dayKey), [assets, dayKey, employees, timeEntries]);
  const locationDays = useMemo(() => locatedPunchDates(timeEntries), [timeEntries]);

  const filteredPins = useMemo(
    () => (employeeFilter === ALL_EMPLOYEES ? dayPunches.pins : dayPunches.pins.filter((pin) => pin.employeeKey === employeeFilter)),
    [dayPunches.pins, employeeFilter],
  );
  const filteredMissing = useMemo(
    () => (employeeFilter === ALL_EMPLOYEES ? dayPunches.missing : dayPunches.missing.filter((row) => row.employeeKey === employeeFilter)),
    [dayPunches.missing, employeeFilter],
  );
  const filteredSegments = useMemo(() => {
    if (employeeFilter === ALL_EMPLOYEES) return dayPunches.segments;
    const entryIds = new Set(filteredPins.map((pin) => pin.entryId));
    return dayPunches.segments.filter((segment) => entryIds.has(segment.entryId));
  }, [dayPunches.segments, employeeFilter, filteredPins]);

  const employeesOnDay = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pin of dayPunches.pins) seen.set(pin.employeeKey, pin.employeeName);
    for (const row of dayPunches.missing) seen.set(row.employeeKey, row.employeeName);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [dayPunches.missing, dayPunches.pins]);

  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5" /> Punch map
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Clock-in and clock-out locations for {format(selectedDate, 'EEEE, MMM d')}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{filteredPins.length} located</Badge>
            {filteredMissing.length > 0 ? <Badge variant="outline">{filteredMissing.length} without GPS</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? <p className="text-sm text-destructive">Punch locations could not be loaded. {loadError}</p> : null}
        {isLoading ? <p className="text-sm text-muted-foreground">Loading punch locations...</p> : null}

        <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="punch-map-employee">Employee</Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger id="punch-map-employee" className="w-full bg-background">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EMPLOYEES}>All employees</SelectItem>
                {employeesOnDay.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="punch-map-calendar">Calendar</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="punch-map-calendar"
                  type="button"
                  variant="outline"
                  className="w-full justify-between bg-background font-normal"
                >
                  <span className="flex items-center">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, 'MMM d, yyyy')}
                  </span>
                  <ChevronDown className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date: Date | undefined) => {
                    if (date) {
                      onSelectDate(startOfDay(date));
                      setCalendarOpen(false);
                    }
                  }}
                  modifiers={{ hasLocation: locationDays }}
                  modifiersClassNames={{
                    hasLocation:
                      'relative after:absolute after:bottom-0.5 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary',
                  }}
                  initialFocus
                />
                <p className="px-3 pb-3 text-xs text-muted-foreground">A dot marks days that have GPS punches.</p>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-[#2f9e44]" /> Clock in
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-[#e8590c]" /> Clock out
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-[#c92a2a]" /> Over 1 mi from shop
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex size-2.5 items-center justify-center rounded-sm bg-[#1c7ed6] text-[8px] font-bold text-white">
              S
            </span>
            Shop
          </span>
        </div>

        <PunchMapCanvas pins={filteredPins} segments={filteredSegments} selectedPinId={selectedPinId} onSelectPin={setSelectedPinId} />

        {!isLoading && filteredPins.length === 0 && filteredMissing.length === 0 ? (
          <p className="text-sm text-muted-foreground">No labor punches on {format(selectedDate, 'MMM d, yyyy')}.</p>
        ) : null}

        {filteredPins.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Located punches</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {filteredPins.map((pin) => {
                const far = pin.distanceMiles != null && pin.distanceMiles > NEARBY_MILES;
                return (
                  <li key={pin.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedPinId(pin.id)}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${selectedPinId === pin.id ? 'bg-muted' : ''}`}
                    >
                      <span className="font-medium">{pin.employeeName}</span>
                      <span className="text-muted-foreground">
                        Clock {pin.kind} · {format(new Date(pin.at), 'p')}
                        {pin.distanceMiles != null ? ` · ${pin.distanceMiles.toFixed(1)} mi` : ''}
                      </span>
                      {far ? (
                        <Badge variant="destructive" className="text-xs">
                          Far from shop
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {filteredMissing.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">No location recorded</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {filteredMissing.map((row) => {
                const missingParts = [
                  row.missingIn && row.clockIn ? `in ${format(new Date(row.clockIn), 'p')}` : null,
                  row.missingOut && row.clockOut ? `out ${format(new Date(row.clockOut), 'p')}` : null,
                ].filter(Boolean);
                return (
                  <li key={row.entryId}>
                    {row.employeeName} — {missingParts.join(', ') || 'no GPS'} · {row.assetName}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
