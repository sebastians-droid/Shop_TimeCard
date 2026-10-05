import { describe, expect, it } from 'vitest';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry } from '@/models/shop-time-entry';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { SHOP_LOCATION } from '@/lib/geolocation';
import { buildDayPunches, locatedPunchDates, offsetOverlappingPins, type PunchPin } from '@/lib/punch-map';

function at(day: string, time: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0).toISOString();
}

function entry(overrides: Partial<ShopTimeEntry> & { id: string }): ShopTimeEntry {
  return { timeEntry: 'Time entry', ...overrides };
}

function employee(id: string, name: string, code: number): AppShopEmployee {
  return {
    id,
    autoNumber: name,
    empNum: code,
    employee: { id, name1: name },
    employeeName: name,
    employeeCode: code,
    isRoadMech: false,
    isAdmin: false,
  };
}

const employees = [employee('emp-1', 'Alex Smith', 1234), employee('emp-2', 'Pat Jones', 5678)];
const assets: EquipmentAsset[] = [{ id: 'asset-1', asset: 'EX-140', divisionCode: 12 }];
const DAY = '2026-09-30';

function pin(overrides: Partial<PunchPin> & { id: string; lat: number; lon: number }): PunchPin {
  return {
    entryId: 'e',
    kind: 'in',
    displayLat: overrides.lat,
    displayLon: overrides.lon,
    at: at(DAY, '07:00'),
    employeeName: 'Alex Smith',
    employeeNumber: '1234',
    employeeKey: 'emp-1',
    assetName: 'EX-140',
    distanceMiles: 0,
    ...overrides,
  };
}

describe('buildDayPunches', () => {
  it('builds clock-in and clock-out pins for the selected day', () => {
    const result = buildDayPunches(
      [
        entry({
          id: 'e1',
          employee: { id: 'emp-1', autoNumber: 'Alex Smith' },
          asset: { id: 'asset-1', asset: 'EX-140' },
          clockIn: at(DAY, '07:00'),
          clockOut: at(DAY, '15:30'),
          clockInLat: SHOP_LOCATION.lat,
          clockInLon: SHOP_LOCATION.lon,
          clockOutLat: 40.54,
          clockOutLon: -79.61,
        }),
      ],
      employees,
      assets,
      DAY,
    );

    expect(result.pins.map((p) => p.id)).toEqual(['e1-in', 'e1-out']);
    expect(result.pins[0]?.kind).toBe('in');
    expect(result.pins[0]?.employeeName).toBe('Alex Smith');
    expect(result.pins[1]?.kind).toBe('out');
    expect(result.segments).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
  });

  it('skips PTO and other days, and lists punches that have no GPS', () => {
    const result = buildDayPunches(
      [
        entry({
          id: 'pto',
          pTOTimeKey: 'PTOTimeKey18',
          timeEntry: 'Alex Smith - PTO',
          employee: { id: 'emp-1', autoNumber: 'Alex Smith' },
          clockIn: at(DAY, '08:00'),
          clockInLat: SHOP_LOCATION.lat,
          clockInLon: SHOP_LOCATION.lon,
        }),
        entry({
          id: 'other-day',
          employee: { id: 'emp-2', autoNumber: 'Pat Jones' },
          clockIn: at('2026-09-29', '07:00'),
          clockInLat: SHOP_LOCATION.lat,
          clockInLon: SHOP_LOCATION.lon,
        }),
        entry({
          id: 'no-gps',
          employee: { id: 'emp-2', autoNumber: 'Pat Jones' },
          asset: { id: 'asset-1', asset: 'EX-140' },
          clockIn: at(DAY, '06:30'),
          clockOut: at(DAY, '15:00'),
        }),
      ],
      employees,
      assets,
      DAY,
    );

    expect(result.pins).toEqual([]);
    expect(result.segments).toEqual([]);
    expect(result.missing).toEqual([
      expect.objectContaining({
        entryId: 'no-gps',
        employeeName: 'Pat Jones',
        missingIn: true,
        missingOut: true,
      }),
    ]);
  });

  it('lists a clock-out that never recorded a location', () => {
    const result = buildDayPunches(
      [
        entry({
          id: 'partial',
          employee: { id: 'emp-1', autoNumber: 'Alex Smith' },
          clockIn: at(DAY, '07:00'),
          clockOut: at(DAY, '15:00'),
          clockInLat: SHOP_LOCATION.lat,
          clockInLon: SHOP_LOCATION.lon,
        }),
      ],
      employees,
      assets,
      DAY,
    );

    expect(result.pins).toHaveLength(1);
    expect(result.missing).toEqual([expect.objectContaining({ entryId: 'partial', missingIn: false, missingOut: true })]);
    expect(result.segments).toEqual([]);
  });
});

describe('locatedPunchDates', () => {
  it('returns local dates for days that have GPS punches', () => {
    const dates = locatedPunchDates([
      entry({
        id: 'e1',
        clockIn: at(DAY, '07:00'),
        clockInLat: SHOP_LOCATION.lat,
        clockInLon: SHOP_LOCATION.lon,
      }),
      entry({ id: 'e2', clockIn: at('2026-09-29', '07:00') }),
      entry({ id: 'pto', pTOTimeKey: 'PTOTimeKey18', timeEntry: 'Alex - PTO', clockIn: at(DAY, '08:00') }),
    ]);

    expect(dates).toHaveLength(1);
    expect(dates[0]?.getFullYear()).toBe(2026);
    expect(dates[0]?.getMonth()).toBe(8);
    expect(dates[0]?.getDate()).toBe(30);
  });
});

describe('offsetOverlappingPins', () => {
  it('leaves a lone pin on its true coordinates', () => {
    const [only] = offsetOverlappingPins([pin({ id: 'a', lat: 40.5, lon: -79.6 })]);
    expect(only?.displayLat).toBe(40.5);
    expect(only?.displayLon).toBe(-79.6);
  });

  it('spreads stacked punches so markers stay clickable', () => {
    const stacked = offsetOverlappingPins([
      pin({ id: 'a', lat: 40.528539, lon: -79.628823 }),
      pin({ id: 'b', kind: 'out', lat: 40.528539, lon: -79.628823 }),
    ]);

    expect(stacked).toHaveLength(2);
    expect(stacked.map((p) => p.id)).toEqual(['a', 'b']);
    expect(`${stacked[0]?.displayLat},${stacked[0]?.displayLon}`).not.toBe(`${stacked[1]?.displayLat},${stacked[1]?.displayLon}`);
    expect(stacked.some((p) => p.displayLat !== p.lat || p.displayLon !== p.lon)).toBe(true);
  });
});
