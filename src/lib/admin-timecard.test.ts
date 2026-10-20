import { describe, expect, it } from 'vitest';

import {
  ADMIN_DIVISION,
  ADMIN_JOB_NUMBER,
  PARTS_RUNNER_JOB_NUMBER,
  adminTimeEntryLabel,
  clockInOnlyJobNumber,
  clockInOnlyTimeEntryLabel,
  isAdminEmployee,
  isPartsRunnerEmployee,
  usesClockInOnlyTimecard,
} from '@/lib/admin-timecard';

describe('admin timecard', () => {
  it('builds the fixed division and job label', () => {
    expect(adminTimeEntryLabel('Pat Admin')).toBe(`Pat Admin - Division ${ADMIN_DIVISION} · Job ${ADMIN_JOB_NUMBER}`);
  });

  it('detects admin from the employee row or signed-in user', () => {
    expect(isAdminEmployee({ isAdmin: true }, { isAdmin: false })).toBe(true);
    expect(isAdminEmployee(undefined, { isAdmin: true })).toBe(true);
    expect(isAdminEmployee({ isAdmin: false }, undefined)).toBe(false);
  });

  it('detects parts runners and clock-in-only timecards', () => {
    expect(isPartsRunnerEmployee({ isPartsRunner: true }, undefined)).toBe(true);
    expect(usesClockInOnlyTimecard({ isPartsRunner: true }, { isAdmin: false })).toBe(true);
    expect(usesClockInOnlyTimecard({ isPartsRunner: false }, { isAdmin: false })).toBe(false);
  });

  it('uses job 113 for parts runners and 112 for admin', () => {
    expect(clockInOnlyJobNumber({ isPartsRunner: true }, undefined)).toBe(PARTS_RUNNER_JOB_NUMBER);
    expect(clockInOnlyJobNumber({ isAdmin: true }, undefined)).toBe(ADMIN_JOB_NUMBER);
    expect(clockInOnlyTimeEntryLabel('Pat Parts', { isPartsRunner: true }, undefined)).toBe(
      `Pat Parts - Division 200 · Job ${PARTS_RUNNER_JOB_NUMBER}`,
    );
  });
});
