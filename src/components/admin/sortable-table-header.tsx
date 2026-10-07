import { memo, useCallback } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { type SortDirection, type SortState } from '@/lib/admin-table';
import { cn } from '@/lib/utils';

type SortableTableHeaderProps<T extends string> = {
  column: T;
  label: string;
  sort: SortState<T>;
  onSortColumn: (column: T) => void;
  className?: string;
};

function SortableTableHeaderInner<T extends string>({ column, label, sort, onSortColumn, className }: SortableTableHeaderProps<T>) {
  const active = sort.column === column;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;

  const applySort = useCallback(() => {
    onSortColumn(column);
  }, [column, onSortColumn]);

  return (
    <th className={cn('px-3 py-2 align-bottom', className)}>
      <button
        type="button"
        className="flex w-full touch-manipulation select-none items-center gap-1 text-left text-sm font-medium hover:text-foreground active:opacity-70"
        aria-pressed={active}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          // Sort on press so the arrow flips before mouse-up; skip the slower click path.
          event.preventDefault();
          applySort();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            applySort();
          }
        }}
      >
        <span>{label}</span>
        <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-foreground' : 'text-muted-foreground/60')} aria-hidden="true" />
      </button>
    </th>
  );
}

export const SortableTableHeader = memo(SortableTableHeaderInner) as typeof SortableTableHeaderInner;

export type { SortDirection, SortState };
