import { UI_TEXT_META_CLASS, UiButton, UiInput } from '@/components/ui';

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
      <div className={UI_TEXT_META_CLASS}>{label}</div>
      <div className="flex items-center gap-2">
        <UiButton
          type="button"
          size="sm"
          className="h-9 w-9 px-0 text-sm"
          onClick={() => onChange(value - 1)}
          disabled={decreaseDisabled}
        >
          -
        </UiButton>
        <UiInput
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(event) => onChange(Number(event.target.value))}
          textHistory={{ onValueChange: (nextValue) => onChange(Number(nextValue)) }}
          className="h-9 text-center"
        />
        <UiButton
          type="button"
          size="sm"
          className="h-9 w-9 px-0 text-sm"
          onClick={() => onChange(value + 1)}
          disabled={increaseDisabled}
        >
          +
        </UiButton>
      </div>
    </div>
  );
}
