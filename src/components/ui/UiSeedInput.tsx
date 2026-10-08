import { Dices } from 'lucide-react'
import { ParameterNumber } from './ParameterNumber'
import { UiIconButton } from './primitives'
import { clampParameter, useParameterGesture, type ParameterControlProps } from './parameterControl'

export interface UiSeedInputProps extends ParameterControlProps<number> { min?: number; max?: number }

/** Safe-integer bounds are JavaScript's exact integer representation limit, not a product quantity cap. */
export function UiSeedInput(props: UiSeedInputProps) {
  const { value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, size = 'sm', disabled } = props
  const label = props['aria-label'] ?? props.label ?? '随机种子'
  const gesture = useParameterGesture(props)
  const lower = Math.ceil(clampParameter(min, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
  const upper = Math.max(lower, Math.floor(clampParameter(max, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)))
  const normalize = (next: number) => clampParameter(Math.round(next), lower, upper)
  const randomize = () => {
    const words = crypto.getRandomValues(new Uint32Array(2))
    const fraction = ((words[0] & 0x1fffff) * 4294967296 + words[1]) / 9007199254740992
    let next = normalize(lower + Math.floor(fraction * (upper - lower + 1)))
    if (next === value && upper > lower) next = value >= upper ? lower : normalize(value + 1)
    gesture.atomic(() => onChange(next))
  }
  return <div className="flex w-full items-end gap-2">
    <ParameterNumber {...props} label={label} value={value} size={size} defaultValue={props.defaultValue === undefined ? undefined : normalize(props.defaultValue)} min={lower} max={upper} step={1} onChange={next => onChange(normalize(next))} />
    <UiIconButton aria-label={`${label}随机生成`} size={size === 'sm' ? 'md' : 'lg'} disabled={disabled} onClick={randomize}><Dices className="h-4 w-4" /></UiIconButton>
  </div>
}
