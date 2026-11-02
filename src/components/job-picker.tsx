import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { useJobNames, type JobRecord } from '@/hooks/use-shop-data';

const MAX_MATCHES = 50;

type JobPickerProps = {
  id?: string;
  value: string;
  onChange: (jobNumber: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const byNumber = (a: JobRecord, b: JobRecord) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: 'base' });

/**
 * A job number field that suggests jobs by number or name as you type. A
 * number that isn't in the job list is still accepted as typed.
 */
export function JobPicker({ id, value, onChange, placeholder = 'Search job number or name', disabled }: JobPickerProps) {
  const { jobs, jobNames } = useJobNames();
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const sortedJobs = useMemo(() => [...jobs].sort(byNumber), [jobs]);
  const search = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!search) return sortedJobs.slice(0, MAX_MATCHES);
    const numberStarts = sortedJobs.filter((job) => job.jobNumber.toLowerCase().startsWith(search));
    const elsewhere = sortedJobs.filter(
      (job) =>
        !job.jobNumber.toLowerCase().startsWith(search) &&
        (job.jobNumber.toLowerCase().includes(search) || job.jobName.toLowerCase().includes(search)),
    );
    return [...numberStarts, ...elsewhere].slice(0, MAX_MATCHES);
  }, [search, sortedJobs]);
  const selectedName = jobNames.get(search);

  const choose = (job: JobRecord) => {
    onChange(job.jobNumber);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={isOpen}
        autoComplete="off"
        className={`bg-background pr-10 ${selectedName ? 'font-semibold' : ''}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value);
          setHighlighted(0);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setHighlighted((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && isOpen && matches[highlighted] && !selectedName) {
            event.preventDefault();
            choose(matches[highlighted]);
          } else if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            setIsOpen(false);
          }
        }}
      />
      {value && !disabled ? (
        <button
          type="button"
          aria-label="Remove job number"
          title="Remove job number"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()}
          onClick={() => {
            onChange('');
            setIsOpen(false);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
      )}
      {isOpen && !disabled && jobs.length > 0 ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {matches.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No job matches &ldquo;{value}&rdquo;. It will be saved as typed.</p>
          ) : null}
          {matches.map((job: JobRecord, index: number) => {
            const isSelected = job.jobNumber.toLowerCase() === search;
            return (
              <button
                key={job.id}
                type="button"
                className={`flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted focus:bg-muted focus:outline-none ${
                  index === highlighted ? 'bg-muted' : ''
                }`}
                onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(job)}
              >
                <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isSelected ? '' : 'invisible'}`} />
                <span>
                  <span className="font-semibold">{job.jobNumber}</span> - {job.jobName}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
