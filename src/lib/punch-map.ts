import { entryDistanceMiles } from '@/lib/geolocation';
import { getEntryAssetName, getEntryEmployeeKey, getEntryEmployeeName, getEntryEmployeeNumber } from '@/lib/entry-helpers';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { entryWorkDateKey, isAwaitingAsset, isPtoEntry } from '@/lib/time-rules';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

export type PunchKind = 'in' | 'out';

export type PunchPin = {
  id: string;
  entryId: string;
  kind: PunchKind;
  lat: number;
  lon: number;
  displayLat: number;
  displayLon: number;
  at: string;
  employeeName: string;
  employeeNumber: string;
  employeeKey: string;
  assetName: string;
  distanceMiles: number | null;
};

export type MissingPunch = {
  entryId: string;
  employeeName: string;
  employeeNumber: string;
  employeeKey: string;
  assetName: string;
  clockIn?: string;
  clockOut?: string;
  missingIn: boolean;
  missingOut: boolean;
};

export type PunchSegment = {
  entryId: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
};

export type DayPunches = {
  pins: PunchPin[];
  missing: MissingPunch[];
  segments: PunchSegment[];
};

const OVERLAP_PRECISION = 4;
const OVERLAP_OFFSET_DEG = 0.00012;
/** A job switch closes one entry and opens the next at the same instant; allow for second-level rounding. */
const JOB_SWITCH_TOLERANCE_MS = 60 * 1000;

export function entryDayKey(entry: ShopTimeEntry): string | null {
  if (!entry.clockIn) return null;
  return entryWorkDateKey(entry) ?? null;
}

function punchEntriesForDay(entries: ShopTimeEntry[], dayKey: string): ShopTimeEntry[] {
  return entries.filter((entry) => !isPtoEntry(entry) && entryDayKey(entry) === dayKey);
}

function isJobSwitch(previous: ShopTimeEntry, next: ShopTimeEntry): boolean {
  if (!previous.clockOut || !next.clockIn) return false;
  return Math.abs(new Date(next.clockIn).getTime() - new Date(previous.clockOut).getTime()) <= JOB_SWITCH_TOLERANCE_MS;
}

/**
 * Groups one day's entries into shifts: runs of entries joined by job switches.
 * Only a shift's first clock-in and last clock-out are real punches.
 */
export function shiftsForDay(entries: ShopTimeEntry[], dayKey: string): ShopTimeEntry[][] {
  const byEmployee = new Map<string, ShopTimeEntry[]>();
  for (const entry of punchEntriesForDay(entries, dayKey)) {
    const key = getEntryEmployeeKey(entry);
    const list = byEmployee.get(key) ?? [];
    list.push(entry);
    byEmployee.set(key, list);
  }

  const shifts: ShopTimeEntry[][] = [];
  for (const list of byEmployee.values()) {
    list.sort((a, b) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
    let current: ShopTimeEntry[] = [];
    for (const entry of list) {
      const previous = current[current.length - 1];
      if (previous && !isJobSwitch(previous, entry)) {
        shifts.push(current);
        current = [];
      }
      current.push(entry);
    }
    if (current.length > 0) shifts.push(current);
  }
  // A clock-in that never started a job is left off, as before.
  return shifts.filter((shift) => shift.some((entry) => !isAwaitingAsset(entry)));
}

export function locatedPunchDates(entries: ShopTimeEntry[]): Date[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (isPtoEntry(entry)) continue;
    const dayKey = entryDayKey(entry);
    if (!dayKey) continue;
    const hasIn = entry.clockInLat != null && entry.clockInLon != null;
    const hasOut = entry.clockOutLat != null && entry.clockOutLon != null;
    if (hasIn || hasOut) keys.add(dayKey);
  }
  return [...keys].map((key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
}

function asPosition(lat: number | undefined, lon: number | undefined): { lat: number; lon: number } | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function offsetOverlappingPins(pins: PunchPin[]): PunchPin[] {
  const groups = new Map<string, PunchPin[]>();
  for (const pin of pins) {
    const key = `${pin.lat.toFixed(OVERLAP_PRECISION)},${pin.lon.toFixed(OVERLAP_PRECISION)}`;
    const group = groups.get(key) ?? [];
    group.push(pin);
    groups.set(key, group);
  }

  const byId = new Map<string, PunchPin>();
  for (const group of groups.values()) {
    group.forEach((pin, index) => {
      if (group.length === 1) {
        byId.set(pin.id, { ...pin, displayLat: pin.lat, displayLon: pin.lon });
        return;
      }
      const angle = (2 * Math.PI * index) / group.length - Math.PI / 2;
      byId.set(pin.id, {
        ...pin,
        displayLat: pin.lat + OVERLAP_OFFSET_DEG * Math.cos(angle),
        displayLon: pin.lon + OVERLAP_OFFSET_DEG * Math.sin(angle),
      });
    });
  }
  return pins.map((pin) => byId.get(pin.id) ?? pin);
}

export function buildDayPunches(
  entries: ShopTimeEntry[],
  employees: AppShopEmployee[],
  assets: EquipmentAsset[],
  dayKey: string,
): DayPunches {
  const pins: PunchPin[] = [];
  const missing: MissingPunch[] = [];
  const segments: PunchSegment[] = [];

  for (const shift of shiftsForDay(entries, dayKey)) {
    const first = shift[0];
    const last = shift[shift.length - 1];
    const jobs = shift.filter((entry) => !isAwaitingAsset(entry));
    const employeeName = getEntryEmployeeName(first, employees);
    const employeeNumber = getEntryEmployeeNumber(first, employees);
    const employeeKey = getEntryEmployeeKey(first);
    const inAssetName = getEntryAssetName(jobs[0] ?? first, assets);
    const outAssetName = getEntryAssetName(jobs[jobs.length - 1] ?? last, assets);
    const inPos = asPosition(first.clockInLat, first.clockInLon);
    const outPos = asPosition(last.clockOutLat, last.clockOutLon);

    if (inPos && first.clockIn) {
      pins.push({
        id: `${first.id}-in`,
        entryId: first.id,
        kind: 'in',
        lat: inPos.lat,
        lon: inPos.lon,
        displayLat: inPos.lat,
        displayLon: inPos.lon,
        at: first.clockIn,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName: inAssetName,
        distanceMiles: entryDistanceMiles(inPos.lat, inPos.lon),
      });
    }

    if (outPos && last.clockOut) {
      pins.push({
        id: `${last.id}-out`,
        entryId: last.id,
        kind: 'out',
        lat: outPos.lat,
        lon: outPos.lon,
        displayLat: outPos.lat,
        displayLon: outPos.lon,
        at: last.clockOut,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName: outAssetName,
        distanceMiles: entryDistanceMiles(outPos.lat, outPos.lon),
      });
    }

    if (inPos && outPos) {
      segments.push({
        entryId: first.id,
        from: inPos,
        to: outPos,
      });
    }

    const missingIn = Boolean(first.clockIn) && !inPos;
    const missingOut = Boolean(last.clockOut) && !outPos;
    if (missingIn || missingOut) {
      missing.push({
        entryId: first.id,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName: inAssetName,
        clockIn: first.clockIn,
        clockOut: last.clockOut,
        missingIn,
        missingOut,
      });
    }
  }

  pins.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id));
  missing.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.entryId.localeCompare(b.entryId));

  return { pins: offsetOverlappingPins(pins), missing, segments };
}
