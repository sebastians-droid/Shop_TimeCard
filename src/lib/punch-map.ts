import { format } from 'date-fns';

import { entryDistanceMiles } from '@/lib/geolocation';
import { getEntryAssetName, getEntryEmployeeKey, getEntryEmployeeName, getEntryEmployeeNumber } from '@/lib/entry-helpers';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { isAwaitingAsset, isPtoEntry } from '@/lib/time-rules';
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

export function entryDayKey(entry: ShopTimeEntry): string | null {
  if (!entry.clockIn) return null;
  return format(new Date(entry.clockIn), 'yyyy-MM-dd');
}

export function laborEntriesForDay(entries: ShopTimeEntry[], dayKey: string): ShopTimeEntry[] {
  return entries.filter((entry) => !isPtoEntry(entry) && !isAwaitingAsset(entry) && entryDayKey(entry) === dayKey);
}

export function locatedPunchDates(entries: ShopTimeEntry[]): Date[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (isPtoEntry(entry) || isAwaitingAsset(entry)) continue;
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

  for (const entry of laborEntriesForDay(entries, dayKey)) {
    const employeeName = getEntryEmployeeName(entry, employees);
    const employeeNumber = getEntryEmployeeNumber(entry, employees);
    const employeeKey = getEntryEmployeeKey(entry);
    const assetName = getEntryAssetName(entry, assets);
    const inPos = asPosition(entry.clockInLat, entry.clockInLon);
    const outPos = asPosition(entry.clockOutLat, entry.clockOutLon);

    if (inPos && entry.clockIn) {
      pins.push({
        id: `${entry.id}-in`,
        entryId: entry.id,
        kind: 'in',
        lat: inPos.lat,
        lon: inPos.lon,
        displayLat: inPos.lat,
        displayLon: inPos.lon,
        at: entry.clockIn,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName,
        distanceMiles: entryDistanceMiles(inPos.lat, inPos.lon),
      });
    }

    if (outPos && entry.clockOut) {
      pins.push({
        id: `${entry.id}-out`,
        entryId: entry.id,
        kind: 'out',
        lat: outPos.lat,
        lon: outPos.lon,
        displayLat: outPos.lat,
        displayLon: outPos.lon,
        at: entry.clockOut,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName,
        distanceMiles: entryDistanceMiles(outPos.lat, outPos.lon),
      });
    }

    if (inPos && outPos) {
      segments.push({
        entryId: entry.id,
        from: inPos,
        to: outPos,
      });
    }

    const missingIn = Boolean(entry.clockIn) && !inPos;
    const missingOut = Boolean(entry.clockOut) && !outPos;
    if (missingIn || missingOut) {
      missing.push({
        entryId: entry.id,
        employeeName,
        employeeNumber,
        employeeKey,
        assetName,
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        missingIn,
        missingOut,
      });
    }
  }

  pins.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id));
  missing.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.entryId.localeCompare(b.entryId));

  return { pins: offsetOverlappingPins(pins), missing, segments };
}
