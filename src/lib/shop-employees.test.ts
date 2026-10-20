import { describe, expect, it } from 'vitest';

import {
  compareEmployeesByTypeThenName,
  employeeMechanicType,
  employeeMechanicTypeLabel,
  formatEmployeeDisplayName,
  mapShopEmployees,
  shopEmployeeDisplayName,
} from '@/lib/shop-employees';

describe('formatEmployeeDisplayName', () => {
  it('formats first last as last, first', () => {
    expect(formatEmployeeDisplayName('Dana Ruiz')).toBe('Ruiz, Dana');
  });

  it('keeps a middle initial after the first name', () => {
    expect(formatEmployeeDisplayName('AIDAN A WINTERS')).toBe('WINTERS, AIDAN A');
    expect(formatEmployeeDisplayName('THOMAS R ION')).toBe('ION, THOMAS R');
  });

  it('reduces a full middle name to an initial', () => {
    expect(formatEmployeeDisplayName('Alison Marie Hirshka')).toBe('Hirshka, Alison M');
  });

  it('keeps a generation suffix with the last name', () => {
    expect(formatEmployeeDisplayName('GARY L REITLER JR')).toBe('REITLER JR, GARY L');
    expect(formatEmployeeDisplayName('John Smith Jr.')).toBe('Smith JR, John');
  });

  it('keeps last-name particles with the last name', () => {
    expect(formatEmployeeDisplayName('JOHN A VAN DYKE')).toBe('VAN DYKE, JOHN A');
  });

  it('normalizes a name that is already last, first', () => {
    expect(formatEmployeeDisplayName('WINTERS, AIDAN A')).toBe('WINTERS, AIDAN A');
    expect(formatEmployeeDisplayName('Hirshka, Alison Marie')).toBe('Hirshka, Alison M');
  });

  it('leaves single tokens and empty values alone', () => {
    expect(formatEmployeeDisplayName('Madonna')).toBe('Madonna');
    expect(formatEmployeeDisplayName('SE-001')).toBe('SE-001');
    expect(formatEmployeeDisplayName('')).toBe('');
    expect(formatEmployeeDisplayName(undefined)).toBe('');
  });
});

describe('shopEmployeeDisplayName', () => {
  it('prefers the formatted HR name, then the auto number', () => {
    expect(shopEmployeeDisplayName({ autoNumber: 'SE-001', employee: { id: 'e1', name1: 'AIDAN A WINTERS' } })).toBe('WINTERS, AIDAN A');
    expect(shopEmployeeDisplayName({ autoNumber: 'SE-001' })).toBe('SE-001');
  });
});

describe('employeeMechanicType', () => {
  it('labels shop, road, parts runner, and admin employees', () => {
    expect(employeeMechanicTypeLabel({ isRoadMech: false, isAdmin: false })).toBe('Shop mechanic');
    expect(employeeMechanicTypeLabel({ isRoadMech: true, isAdmin: false })).toBe('Road mechanic');
    expect(employeeMechanicTypeLabel({ isRoadMech: false, isPartsRunner: true })).toBe('Parts runner');
    expect(employeeMechanicTypeLabel({ isRoadMech: false, isAdmin: true })).toBe('Admin');
    expect(employeeMechanicType({ isRoadMech: true, isAdmin: true })).toBe('admin');
  });

  it('sorts by type shop → road → parts runner → admin, then by name within each type', () => {
    const shopA = { isRoadMech: false, isAdmin: false };
    const shopB = { isRoadMech: false, isAdmin: false };
    const road = { isRoadMech: true, isAdmin: false };
    const parts = { isPartsRunner: true };
    const admin = { isRoadMech: false, isAdmin: true };
    expect(compareEmployeesByTypeThenName(shopA, road, 'Zulu', 'Alpha')).toBeLessThan(0);
    expect(compareEmployeesByTypeThenName(road, parts, 'Alpha', 'Zulu')).toBeLessThan(0);
    expect(compareEmployeesByTypeThenName(parts, admin, 'Alpha', 'Zulu')).toBeLessThan(0);
    expect(compareEmployeesByTypeThenName(shopA, shopB, 'Adams', 'Baker')).toBeLessThan(0);
  });
});

describe('mapShopEmployees name order', () => {
  it('displays and sorts by last name', () => {
    const mapped = mapShopEmployees([
      { id: 'a', autoNumber: 'SE-001', empNum: 1042, employee: { id: 'e1', name1: 'AIDAN A WINTERS' } },
      { id: 'b', autoNumber: 'SE-002', empNum: 1007, employee: { id: 'e2', name1: 'ALISON M HIRSHKA' } },
    ]);
    expect(mapped.map((employee) => employee.employeeName)).toEqual(['HIRSHKA, ALISON M', 'WINTERS, AIDAN A']);
  });
});
