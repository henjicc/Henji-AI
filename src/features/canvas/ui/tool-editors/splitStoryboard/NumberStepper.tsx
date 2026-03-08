import { UiInput } from '@/components/ui';

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps): JSX.Element {
  const decreaseDisabled = value <= min;
  const increaseDisabled = value >= max;

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value - 1)}
          disabled={decreaseDisabled}
        >
          -
        </button>
        <UiInput
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 text-center"
        />
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value + 1)}
          disabled={increaseDisabled}
        >
          +
        </button>
      </div>
    </div>
  );
}
