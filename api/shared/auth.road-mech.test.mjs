import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dataverse = require('./dataverse.js');

let rows = [];
dataverse.listEmployeeTimeEntries = async () => rows.map((row) => ({ ...row }));
dataverse.getTimeEntryPunch = async (id) => {
  const row = rows.find((item) => item.id === id);
  return { id: row.id, employeeId: 'emp', clockIn: row.clockIn, clockOut: row.clockOut, workDate: row.workDate };
};

const { assertTimeEntryAccess, assertTimeEntryCreate, assertTimeEntryDelete } = require('./auth.js');

const roadMech = { isRoadMech: true, canPunch: true, shopEmployeeId: 'emp' };
const shopMech = { canPunch: false, shopEmployeeId: 'emp' };

function dayKey(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function at(key, time) {
  return `${key}T${time}:00.000Z`;
}

function seed(daysAgo = 1) {
  const key = dayKey(daysAgo);
  rows = [
    { id: 'w', timeEntry: 'Alex - Waiting', clockIn: at(key, '11:00'), clockOut: at(key, '11:30'), workDate: key },
    { id: 'a', timeEntry: 'Alex - LOADER-7', clockIn: at(key, '11:30'), clockOut: at(key, '14:00'), workDate: key },
    { id: 'b', timeEntry: 'Alex - TRUCK-2', clockIn: at(key, '14:00'), clockOut: at(key, '19:00'), workDate: key },
  ];
  return key;
}

describe('employee job-time edits', () => {
  let key;
  beforeEach(() => {
    key = seed();
  });

  it('allows moving a boundary between two jobs', async () => {
    await expect(assertTimeEntryAccess(roadMech, 'b', { clockIn: at(key, '13:00') })).resolves.toBeUndefined();
  });

  it('refuses a change that moves the clock-in or clock-out', async () => {
    await expect(assertTimeEntryAccess(roadMech, 'w', { clockIn: at(key, '10:30') })).rejects.toThrow(/clock-in, clock-out, or break/);
    await expect(assertTimeEntryAccess(roadMech, 'b', { clockOut: at(key, '20:00') })).rejects.toThrow(/clock-in, clock-out, or break/);
  });

  it('refuses a shrink that would open a gap', async () => {
    await expect(assertTimeEntryAccess(roadMech, 'a', { clockOut: at(key, '13:00') })).rejects.toThrow(/clock-in, clock-out, or break/);
  });

  it('refuses days older than a week', async () => {
    key = seed(10);
    await expect(assertTimeEntryAccess(roadMech, 'b', { clockIn: at(key, '13:00') })).rejects.toThrow(/last 7 days/);
  });

  it('allows a job added inside the day but not one that runs past clock-out', async () => {
    const employee = { id: 'emp' };
    await expect(
      assertTimeEntryCreate(roadMech, { employee, clockIn: at(key, '12:00'), clockOut: at(key, '13:00'), workDate: key }),
    ).resolves.toBeUndefined();
    await expect(
      assertTimeEntryCreate(roadMech, { employee, clockIn: at(key, '18:00'), clockOut: at(key, '21:00'), workDate: key }),
    ).rejects.toThrow(/clock-in, clock-out, or break/);
  });

  it('still lets a road mechanic clock in with an open punch', async () => {
    await expect(assertTimeEntryCreate(roadMech, { employee: { id: 'emp' }, clockIn: new Date().toISOString() })).resolves.toBeUndefined();
  });

  it('deletes only rows other jobs already cover', async () => {
    await expect(assertTimeEntryDelete(roadMech, 'a')).rejects.toThrow(/clock-in, clock-out, or break/);
    rows = rows.map((row) => (row.id === 'a' ? { ...row, clockIn: at(key, '11:00') } : row));
    await expect(assertTimeEntryDelete(roadMech, 'w')).resolves.toBeUndefined();
  });

  it('holds shop mechanics to the same punched-day rule', async () => {
    await expect(assertTimeEntryAccess(shopMech, 'b', { clockIn: at(key, '13:00') })).resolves.toBeUndefined();
    await expect(assertTimeEntryAccess(shopMech, 'b', { clockOut: at(key, '20:00') })).rejects.toThrow(/clock-in, clock-out, or break/);
    await expect(assertTimeEntryDelete(shopMech, 'a')).rejects.toThrow(/clock-in, clock-out, or break/);
  });

  it('lets a shop mechanic reshape jobs while still clocked in', async () => {
    const today = dayKey(0);
    const started = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const switched = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    rows = [
      { id: 'a', timeEntry: 'Alex - LOADER-7', clockIn: started, clockOut: switched, workDate: today },
      { id: 'b', timeEntry: 'Alex - TRUCK-2', clockIn: switched, workDate: today },
    ];
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await expect(assertTimeEntryAccess(shopMech, 'b', { clockIn: earlier })).resolves.toBeUndefined();
    await expect(assertTimeEntryAccess(shopMech, 'a', { clockIn: earlier })).rejects.toThrow(/clock-in, clock-out, or break/);
  });

  it('keeps clock-in at the kiosk for shop mechanics', async () => {
    await expect(assertTimeEntryCreate(shopMech, { employee: { id: 'emp' }, clockIn: new Date().toISOString() })).rejects.toThrow(
      /shop kiosk/,
    );
  });
});
