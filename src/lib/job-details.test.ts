import { describe, expect, it } from 'vitest';

import { buildJobDetails, formatJobLabel } from '@/lib/job-details';

describe('buildJobDetails', () => {
  it('sends a removed asset and job number as cleared, not omitted', () => {
    const result = buildJobDetails('Pat Lee', { asset: undefined, division: '700', jobNumber: '' });
    expect(result).toEqual({
      label: 'Division 700',
      fields: { timeEntry: 'Pat Lee - Division 700', asset: null, assetDivision: 700, division: 700, jobNumber: '' },
    });
  });

  it('clears the division when the asset and division are both removed', () => {
    const result = buildJobDetails('Pat Lee', { division: '', jobNumber: '4821' });
    expect('fields' in result && result.fields).toMatchObject({ asset: null, division: null, assetDivision: null, jobNumber: '4821' });
  });

  it('refuses to strip a job of everything unless it is unassigned time', () => {
    expect(buildJobDetails('Pat Lee', { division: ' ', jobNumber: '' })).toHaveProperty('error');
    expect(buildJobDetails('Pat Lee', { division: '', jobNumber: '' }, { allowUnassigned: true })).toMatchObject({
      label: 'Waiting',
      fields: { asset: null, division: null, jobNumber: '' },
    });
  });

  it('rejects a non-numeric division', () => {
    expect(buildJobDetails('Pat Lee', { division: '7a', jobNumber: '' })).toEqual({ error: 'Division must be a number.' });
  });
});

describe('formatJobLabel', () => {
  const names = new Map([['4821', 'Main St Bridge']]);

  it('adds the job name after the number', () => {
    expect(formatJobLabel('4821', names)).toBe('4821 - Main St Bridge');
  });

  it('keeps the bare number when the job is unknown', () => {
    expect(formatJobLabel('9999', names)).toBe('9999');
  });
});
