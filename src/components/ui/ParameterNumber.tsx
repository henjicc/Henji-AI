import NumberInput from './NumberInput'
import { useRef } from 'react'
import type { ParameterControlProps } from './parameterControl'

/** Readout adapter: NumberInput remains the only numeric editing/scrubbing implementation. */
export function ParameterNumber({ value, onChange, defaultValue, label, disabled, size = 'sm', onBegin, onFinish, onCancel, min, max, step = 1 }: ParameterControlProps<number> & { min?: number; max?: number; step?: number }) {
  const scrubbing = useRef(false)
  return <div className="min-w-0 flex-1">
    <NumberInput label={label} ariaLabel={label} value={value} defaultValue={defaultValue} min={min} max={max} step={step} size={size} disabled={disabled}
      widthClassName="w-full" onChange={next => { if (scrubbing.current) onChange(next); else if (!disabled) { onBegin(); onChange(next); onFinish() } }}
      onScrubStart={() => { scrubbing.current = true; onBegin() }} onScrubEnd={cancelled => { scrubbing.current = false; if (cancelled) onCancel(); else onFinish() }} />
  </div>
}
