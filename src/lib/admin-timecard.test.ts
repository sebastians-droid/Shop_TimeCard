import { describe, expect, it } from 'vitest';

import { ADMIN_DIVISION, ADMIN_JOB_NUMBER, adminTimeEntryLabel, isAdminEmployee } from '@/lib/admin-timecard';

describe('admin timecard', () => {
  it('builds the fixed division and job label', () => {
    expect(adminTimeEntryLabel('Pat Admin')).toBe(`Pat Admin - Division ${ADMIN_DIVISION} · Job ${ADMIN_JOB_NUMBER}`);
  });

  it('detects admin from the employee row or signed-in user', () => {
    expect(isAdminEmployee({ isAdmin: true }, { isAdmin: false })).toBe(true);
    expect(isAdminEmployee(undefined, { isAdmin: true })).toBe(true);
    expect(isAdminEmployee({ isAdmin: false }, undefined)).toBe(false);
  });
});
