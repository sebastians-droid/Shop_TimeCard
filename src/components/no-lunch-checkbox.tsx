import { Check } from 'lucide-react';

type NoLunchCheckboxProps = {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function NoLunchCheckbox({ checked, disabled, onCheckedChange }: NoLunchCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onCheckedChange(!checked);
      }}
      className={`flex w-full items-center gap-4 rounded-xl border-2 px-4 py-4 text-left transition-colors disabled:opacity-60 ${
        checked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 ${
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background'
        }`}
      >
        {checked ? <Check className="h-6 w-6" /> : null}
      </span>
      <span>
        <span className="block text-lg font-semibold text-foreground">No lunch</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          Check this if no 30-minute lunch was taken. Otherwise 0.5 hours is deducted from today’s paid time.
        </span>
      </span>
    </button>
  );
}
