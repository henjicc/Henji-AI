import { ParameterNumber } from './ParameterNumber'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, wrapParameter, type ParameterControlProps } from './parameterControl'
import { UI_PARAMETER_HANDLE_CLASS, UI_PARAMETER_SURFACE_CLASS } from './styleTokens'

export interface UiAngleDialProps extends ParameterControlProps<number> { min?: number; max?: number; wrap?: boolean; step?: number }
const TICKS = Array.from({ length: 24 }, (_, index) => {
  const angle = index * Math.PI / 12
  return { x1: 50 + Math.cos(angle) * 43, y1: 50 + Math.sin(angle) * 43, x2: 50 + Math.cos(angle) * 47, y2: 50 + Math.sin(angle) * 47 }
})

export function UiAngleDial(props: UiAngleDialProps) {
  const { value, onChange, defaultValue, min = -180, max = 180, wrap = false, step = 1, disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '角度'
  const gesture = useParameterGesture(props)
  const normalize = (next: number) => wrap ? wrapParameter(next, min, max) : clampParameter(next, min, max)
  const set = (event: React.PointerEvent<SVGSVGElement>) => {
    const { x, y } = parameterPosition(event)
    const angle = Math.atan2(y - .5, x - .5) * 180 / Math.PI
    // Lift the principal angle into the configured interval before clamp/wrap.
    const lifted = angle + Math.round(((min + max) / 2 - angle) / 360) * 360
    onChange(normalize(lifted))
  }
  const angle = value * Math.PI / 180
  return <div className={`grid w-full items-center gap-2 ${size === 'sm' ? 'grid-cols-2' : 'grid-cols-1'}`}>
    {/* icon-token-allow 数据驱动的角度刻度与指针，是可交互参数图形。 */}
    <svg viewBox="0 0 100 100" className={`${UI_PARAMETER_SURFACE_CLASS} aspect-square rounded-full`} role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}度`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      {...gesture.handlers} onPointerDown={event => { if (gesture.begin(event)) set(event) }} onPointerMove={event => { if (gesture.active(event)) set(event) }}
      onDoubleClick={() => { if (defaultValue !== undefined) gesture.atomic(() => onChange(normalize(defaultValue))) }}
      onKeyDown={event => {
        const delta = parameterKeyStep(event.key, event.shiftKey, step)
        if (!delta && !(event.key === 'Home' && defaultValue !== undefined)) return
        event.preventDefault(); gesture.atomic(() => onChange(normalize(event.key === 'Home' ? defaultValue! : value + delta)))
      }}>
      {TICKS.map((tick, index) => <line key={index} {...tick} className="stroke-line-strong" pointerEvents="none" />)}
      <line x1="50" y1="50" x2={50 + Math.cos(angle) * 38} y2={50 + Math.sin(angle) * 38} className="stroke-accent" strokeWidth="2" pointerEvents="none" />
      <circle cx="50" cy="50" r="3" className={UI_PARAMETER_HANDLE_CLASS} pointerEvents="none" />
    </svg>
    <ParameterNumber {...props} label={`${label}读数`} size={size} min={min} max={max} step={step} onChange={next => onChange(normalize(next))} />
  </div>
}
