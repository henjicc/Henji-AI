import { ParameterNumber } from './ParameterNumber'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, wrapParameter, type ParameterControlProps } from './parameterControl'
import { UI_GRADE_LUMINANCE_BACKGROUND, UI_GRADE_WHEEL_BACKGROUND, UI_PARAMETER_SURFACE_CLASS } from './styleTokens'

export interface UiGradeWheelValue { hue: number; strength: number; luminance: number }
export type UiGradeWheelProps = ParameterControlProps<UiGradeWheelValue>

export function UiGradeWheel(props: UiGradeWheelProps) {
  const { value, onChange, defaultValue, disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '调色色轮'
  const disc = useParameterGesture(props); const luminance = disc
  const normalize = (next: UiGradeWheelValue) => ({ hue: wrapParameter(next.hue, 0, 360), strength: clampParameter(next.strength), luminance: clampParameter(next.luminance, -1, 1) })
  const write = (next: Partial<UiGradeWheelValue>) => onChange(normalize({ ...value, ...next }))
  const setDisc = (event: React.PointerEvent<HTMLDivElement>) => {
    const position = parameterPosition(event); const x = position.x * 2 - 1; const y = position.y * 2 - 1
    write({ hue: Math.hypot(x, y) < .001 ? value.hue : Math.atan2(y, x) * 180 / Math.PI, strength: Math.hypot(x, y) })
  }
  const setLight = (event: React.PointerEvent<HTMLDivElement>) => write({ luminance: 1 - parameterPosition(event).y * 2 })
  const angle = value.hue * Math.PI / 180
  return <div className="w-full space-y-2">
    {props.label && <div className="text-xs text-text2">{props.label}</div>}
    <div className="flex items-stretch gap-2">
      <div className={`${UI_PARAMETER_SURFACE_CLASS} aspect-square flex-1 rounded-full`} style={{ background: UI_GRADE_WHEEL_BACKGROUND }} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={value.strength} aria-valuetext={`色相${value.hue}度，强度${Math.round(value.strength * 100)}%`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        {...disc.handlers} onPointerDown={event => { if (disc.begin(event)) setDisc(event) }} onPointerMove={event => { if (disc.active(event)) setDisc(event) }}
        onDoubleClick={() => { if (defaultValue) disc.atomic(() => write({ hue: defaultValue.hue, strength: defaultValue.strength })) }}
        onKeyDown={event => {
          const delta = parameterKeyStep(event.key, event.shiftKey, 1)
          if (!delta && !(event.key === 'Home' && defaultValue)) return
          event.preventDefault(); disc.atomic(() => event.key === 'Home' ? write({ hue: defaultValue!.hue, strength: defaultValue!.strength }) : write(event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? { hue: value.hue + delta } : { strength: value.strength + delta / 100 }))
        }}>
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-on-media bg-media shadow-thumb-ring" style={{ left: `${50 + Math.cos(angle) * value.strength * 50}%`, top: `${50 + Math.sin(angle) * value.strength * 50}%` }} />
      </div>
      <div className={`${UI_PARAMETER_SURFACE_CLASS} w-6 shrink-0`} style={{ background: UI_GRADE_LUMINANCE_BACKGROUND }} role="slider" aria-label={`${label}亮度`} aria-orientation="vertical" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={value.luminance} aria-valuetext={`${value.luminance}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        {...luminance.handlers} onPointerDown={event => { if (luminance.begin(event)) setLight(event) }} onPointerMove={event => { if (luminance.active(event)) setLight(event) }}
        onDoubleClick={() => { if (defaultValue) luminance.atomic(() => write({ luminance: defaultValue.luminance })) }}
        onKeyDown={event => {
          const delta = parameterKeyStep(event.key, event.shiftKey, .01)
          if (!delta && !(event.key === 'Home' && defaultValue)) return
          event.preventDefault(); luminance.atomic(() => write({ luminance: event.key === 'Home' ? defaultValue!.luminance : value.luminance + delta }))
        }}>
        <span className="pointer-events-none absolute left-0 h-2 w-full -translate-y-1/2 rounded-control border border-on-media bg-media shadow-thumb-ring" style={{ top: `${(1 - value.luminance) * 50}%` }} />
      </div>
    </div>
    <div className="flex gap-2">
      <ParameterNumber {...props} label={`${label}色相°`} size={size} value={value.hue} defaultValue={defaultValue?.hue} min={0} max={360} onChange={next => write({ hue: next })} />
      <ParameterNumber {...props} label={`${label}强度%`} size={size} value={value.strength * 100} defaultValue={defaultValue && defaultValue.strength * 100} min={0} max={100} onChange={next => write({ strength: next / 100 })} />
      <ParameterNumber {...props} label={`${label}亮度读数`} size={size} value={value.luminance} defaultValue={defaultValue?.luminance} min={-1} max={1} step={.01} onChange={next => write({ luminance: next })} />
    </div>
  </div>
}
