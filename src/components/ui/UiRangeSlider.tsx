import { useRef } from 'react'
import { ParameterNumber } from './ParameterNumber'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_PARAMETER_SURFACE_CLASS, UI_PARAMETER_TRACK_BACKGROUND } from './styleTokens'

export interface UiRangeSliderProps extends ParameterControlProps<[number, number]> { min?: number; max?: number; step?: number; track?: keyof typeof UI_PARAMETER_TRACK_BACKGROUND }

export function UiRangeSlider(props: UiRangeSliderProps) {
  const { value, onChange, defaultValue, min = 0, max = 1, step = .01, track = 'none', disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '区间'
  const active = useRef<0 | 1>(0)
  const gesture = useParameterGesture(props)
  const snap = (next: number) => clampParameter(step > 0 ? Number((min + Math.round((next - min) / step) * step).toPrecision(12)) : next, min, max)
  const normalize = (next: [number, number]): [number, number] => { const a = snap(next[0]); const b = snap(next[1]); return [Math.min(a, b), Math.max(a, b)] }
  const write = (index: 0 | 1, next: number) => onChange(index === 0 ? [Math.min(snap(next), value[1]), value[1]] : [value[0], Math.max(snap(next), value[0])])
  const at = (event: React.PointerEvent<HTMLDivElement>) => min + parameterPosition(event).x * (max - min)
  const fraction = (next: number) => (max > min ? clampParameter((next - min) / (max - min)) : 0) * 100
  return <div className="w-full space-y-2">
    <div className={`${UI_PARAMETER_SURFACE_CLASS} ${size === 'sm' ? 'h-control-sm' : 'h-control-md'}`} style={{ background: UI_PARAMETER_TRACK_BACKGROUND[track] }}
      {...gesture.handlers} onPointerDown={event => {
        if (disabled || event.button !== 0) return
        const target = event.target as HTMLElement
        const index = target.dataset.rangeHandle === '1' ? 1 : target.dataset.rangeHandle === '0' ? 0 : Math.abs(at(event) - value[0]) <= Math.abs(at(event) - value[1]) ? 0 : 1
        if (gesture.begin(event)) { active.current = index; write(index, at(event)); event.currentTarget.querySelector<HTMLElement>(`[data-range-handle="${index}"]`)?.focus() }
      }} onPointerMove={event => { if (gesture.active(event)) write(active.current, at(event)) }}
      onDoubleClick={() => { if (defaultValue) gesture.atomic(() => onChange(normalize(defaultValue))) }}>
      <div className="pointer-events-none absolute inset-y-0 bg-accent/20" style={{ left: `${fraction(value[0])}%`, width: `${fraction(value[1]) - fraction(value[0])}%` }} />
      {([0, 1] as const).map(index => <div key={index} data-range-handle={index} role="slider" aria-label={`${label}${index === 0 ? '起点' : '终点'}`} aria-valuemin={index === 0 ? min : value[0]} aria-valuemax={index === 0 ? value[1] : max} aria-valuenow={value[index]} aria-valuetext={`${value[index]}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        className="absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 rounded-control border border-on-media bg-media shadow-thumb-ring outline-none focus-visible:ring-2 focus-visible:ring-accent-ring" style={{ left: `${fraction(value[index])}%` }}
        onKeyDown={event => {
          const delta = parameterKeyStep(event.key, event.shiftKey, step)
          if (!delta && !(event.key === 'Home' && defaultValue)) return
          event.preventDefault(); gesture.atomic(() => event.key === 'Home' ? onChange(normalize(defaultValue!)) : write(index, value[index] + delta))
        }} />)}
    </div>
    <div className="flex gap-2">{([0, 1] as const).map(index => <ParameterNumber key={index} {...props} label={`${label}${index === 0 ? '起点读数' : '终点读数'}`} value={value[index]} defaultValue={defaultValue?.[index]} size={size} min={index === 0 ? min : value[0]} max={index === 0 ? value[1] : max} step={step} onChange={next => write(index, next)} />)}</div>
  </div>
}
