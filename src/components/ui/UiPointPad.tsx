import { ParameterNumber } from './ParameterNumber'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_PARAMETER_HANDLE_CLASS, UI_PARAMETER_HANDLE_RADIUS, UI_PARAMETER_SURFACE_CLASS } from './styleTokens'

export interface UiParameterPoint { x: number; y: number }
export interface UiPointPadProps extends ParameterControlProps<UiParameterPoint> { aspect?: number; min?: UiParameterPoint; max?: UiParameterPoint; step?: number }

export function UiPointPad(props: UiPointPadProps) {
  const { value, onChange, defaultValue, aspect = 1, min = { x: 0, y: 0 }, max = { x: 1, y: 1 }, step = .01, disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '点位'
  const gesture = useParameterGesture(props)
  const normalize = (point: UiParameterPoint) => ({ x: clampParameter(point.x, min.x, max.x), y: clampParameter(point.y, min.y, max.y) })
  const set = (event: React.PointerEvent<SVGSVGElement>) => onChange(normalize(parameterPosition(event)))
  const x = clampParameter(value.x) * 100; const y = clampParameter(value.y) * 100
  return <div className="w-full space-y-2">
    {/* icon-token-allow 随二维参数位置改变的十字准线与坐标图形。 */}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ aspectRatio: Number.isFinite(aspect) && aspect > 0 ? aspect : 1 }} className={UI_PARAMETER_SURFACE_CLASS}
      role="slider" aria-label={label} aria-valuetext={`X ${value.x}，Y ${value.y}`} aria-valuenow={value.x} aria-valuemin={min.x} aria-valuemax={max.x} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      {...gesture.handlers} onPointerDown={event => { if (gesture.begin(event)) set(event) }} onPointerMove={event => { if (gesture.active(event)) set(event) }}
      onDoubleClick={() => { if (defaultValue) gesture.atomic(() => onChange(normalize(defaultValue))) }}
      onKeyDown={event => {
        const delta = parameterKeyStep(event.key, event.shiftKey, step)
        if (!delta && !(event.key === 'Home' && defaultValue)) return
        event.preventDefault()
        gesture.atomic(() => onChange(normalize(event.key === 'Home' ? defaultValue! : { x: value.x + (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? delta : 0), y: value.y - (event.key === 'ArrowDown' || event.key === 'ArrowUp' ? delta : 0) })))
      }}>
      <path d={`M${x} 0V100M0 ${y}H100`} className="stroke-line-strong" fill="none" pointerEvents="none" />
      <circle cx={x} cy={y} r={UI_PARAMETER_HANDLE_RADIUS[size]} className={UI_PARAMETER_HANDLE_CLASS} pointerEvents="none" />
    </svg>
    <div className="flex gap-2">{(['x', 'y'] as const).map(axis => <ParameterNumber key={axis} {...props} label={`${label} ${axis.toUpperCase()}`} value={value[axis]} defaultValue={defaultValue?.[axis]} min={min[axis]} max={max[axis]} step={step} size={size} onChange={next => onChange(normalize({ ...value, [axis]: next }))} />)}</div>
  </div>
}
