import { describe, expect, it } from 'vitest';

import { compareNumber, compareText, toggleSort } from '@/lib/admin-table';

describe('admin-table', () => {
  it('cycles sort asc → desc → cleared', () => {
    expect(toggleSort({ column: null, direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'asc' });
    expect(toggleSort({ column: 'name', direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'desc' });
    expect(toggleSort({ column: 'name', direction: 'desc' }, 'name')).toEqual({ column: null, direction: 'asc' });
  });

  it('compares text and numbers in both directions', () => {
    expect(compareText('Alpha', 'Beta', 'asc')).toBeLessThan(0);
    expect(compareText('Alpha', 'Beta', 'desc')).toBeGreaterThan(0);
    expect(compareNumber(1042, 999, 'asc')).toBeGreaterThan(0);
    expect(compareNumber(undefined, 10, 'asc')).toBeLessThan(0);
  });
});
