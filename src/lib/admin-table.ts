export type SortDirection = 'asc' | 'desc';

export type SortState<T extends string> = {
  column: T | null;
  direction: SortDirection;
};

export const EMPTY_SORT = { column: null, direction: 'asc' as SortDirection };

export function toggleSort<T extends string>(current: SortState<T>, column: T): SortState<T> {
  if (current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return { column: null, direction: 'asc' };
}

export function compareText(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return direction === 'asc' ? cmp : -cmp;
}

export function compareNumber(a: number | null | undefined, b: number | null | undefined, direction: SortDirection): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  const cmp = av === bv ? 0 : av < bv ? -1 : 1;
  return direction === 'asc' ? cmp : -cmp;
}
