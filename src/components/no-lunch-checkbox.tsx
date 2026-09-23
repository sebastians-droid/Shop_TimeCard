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
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
        checked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background'
        }`}
      >
        {checked ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="font-medium text-foreground">No lunch</span>
    </button>
  );
}
