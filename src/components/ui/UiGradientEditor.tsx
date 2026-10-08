import { useId, useMemo, useRef, useState } from 'react'
import { ParameterNumber } from './ParameterNumber'
import { UiColorInput } from './primitives'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_PARAMETER_SURFACE_CLASS, uiParameterHex, uiParameterRgba } from './styleTokens'

export type UiParameterRgba = [number, number, number, number]
export interface UiGradientStop { at: number; color: UiParameterRgba }
export interface UiGradientEditorProps extends ParameterControlProps<UiGradientStop[]> { maxStops?: number }

export function UiGradientEditor(props: UiGradientEditorProps) {
  const { value, onChange, defaultValue, maxStops = Infinity, disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '渐变'
  const id = useId()
  const [selection, setSelection] = useState(0)
  const selected = Math.min(selection, value.length - 1)
  const stop = value[selected]
  const sorted = useMemo(() => [...value].sort((a, b) => a.at - b.at), [value])
  const gesture = useParameterGesture(props)
  const drag = useRef<{ index: number; stops: UiGradientStop[]; outside: boolean } | null>(null)
  const write = (next: UiGradientStop) => onChange(value.map((entry, index) => index === selected ? next : entry))
  const remove = (stops: UiGradientStop[], index: number) => {
    if (stops.length <= 2) return
    onChange(stops.filter((_, i) => i !== index)); setSelection(Math.max(0, index - 1))
  }
  const sample = (at: number): UiParameterRgba => {
    if (!sorted.length) return [0, 0, 0, 1]
    const right = sorted.find(entry => entry.at >= at) ?? sorted[sorted.length - 1]
    const left = [...sorted].reverse().find(entry => entry.at <= at) ?? sorted[0]
    const t = right.at > left.at ? (at - left.at) / (right.at - left.at) : 0
    return left.color.map((channel, index) => clampParameter(channel + (right.color[index] - channel) * t)) as UiParameterRgba
  }
  return <div className="w-full space-y-2">
    {/* icon-token-allow 用户渐变与可拖动色标，是参数内容预览图形。 */}
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={`${UI_PARAMETER_SURFACE_CLASS} overflow-visible ${size === 'sm' ? 'h-12' : 'h-16'}`} role="group" aria-label={label} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      {...gesture.handlers} onPointerDown={event => {
        if (disabled || event.button !== 0) return
        const handle = (event.target as SVGElement).closest('[data-gradient-stop]')
        if (handle) {
          const index = Number(handle.getAttribute('data-gradient-stop'))
          if (gesture.begin(event)) { setSelection(index); drag.current = { index, stops: value, outside: false }; event.currentTarget.querySelector<SVGElement>(`[data-gradient-stop="${index}"]`)?.focus() }
        } else if (value.length < maxStops && parameterPosition(event).y <= .65) {
          const at = clampParameter(parameterPosition(event).x)
          gesture.atomic(() => { setSelection(value.length); onChange([...value, { at, color: sample(at) }]) })
        }
      }} onPointerMove={event => {
        const current = drag.current; if (!gesture.active(event) || !current) return
        const point = parameterPosition(event); current.outside = point.x < -.05 || point.x > 1.05 || point.y < -.2 || point.y > 1.2
        current.stops = current.stops.map((entry, index) => index === current.index ? { ...entry, at: clampParameter(point.x) } : entry)
        onChange(current.stops)
      }} onPointerUp={event => {
        if (gesture.active(event) && drag.current?.outside) remove(drag.current.stops, drag.current.index)
        drag.current = null; gesture.handlers.onPointerUp(event)
      }} onDoubleClick={() => { if (defaultValue) gesture.atomic(() => onChange(defaultValue.map(entry => ({ ...entry, color: [...entry.color] })))) }}
      onKeyDown={event => { if (event.key === 'Home' && defaultValue) { event.preventDefault(); gesture.atomic(() => onChange(defaultValue.map(entry => ({ ...entry, color: [...entry.color] })))) } }}>
      <defs><linearGradient id={id}>{sorted.map((entry, index) => <stop key={index} offset={clampParameter(entry.at)} stopColor={uiParameterRgba(entry.color)} />)}</linearGradient></defs>
      <rect x="0" y="0" width="100" height="20" fill={`url(#${id})`} />
      {value.map((entry, index) => <path key={index} data-gradient-stop={index} d={`M${entry.at * 100} 20l-3 5v6h6v-6Z`} fill={uiParameterRgba(entry.color)} className={index === selected ? 'stroke-accent' : 'stroke-text1'} strokeWidth="1"
        role="slider" aria-label={`${label}色标${index + 1}`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={entry.at} aria-valuetext={`位置${Math.round(entry.at * 100)}%`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        onFocus={() => setSelection(index)} onKeyDown={event => {
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); if (value.length > 2) gesture.atomic(() => remove(value, index)); return }
          const delta = parameterKeyStep(event.key, event.shiftKey, .01)
          if (!delta) return
          event.preventDefault(); event.stopPropagation(); gesture.atomic(() => onChange(value.map((stop, i) => i === index ? { ...stop, at: clampParameter(stop.at + delta) } : stop)))
        }} />)}
    </svg>
    {stop && <div className="flex items-end gap-2">
      <UiColorInput aria-label={`${label}色标颜色`} disabled={disabled} value={uiParameterHex(stop.color)} onChange={event => {
        const hex = event.target.value
        gesture.atomic(() => write({ ...stop, color: [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255, stop.color[3]] }))
      }} />
      <ParameterNumber {...props} label={`${label}位置%`} value={stop.at * 100} defaultValue={defaultValue?.[selected]?.at !== undefined ? defaultValue[selected].at * 100 : undefined} min={0} max={100} size={size} onChange={next => write({ ...stop, at: clampParameter(next / 100) })} />
      <ParameterNumber {...props} label={`${label}透明度%`} value={stop.color[3] * 100} defaultValue={defaultValue?.[selected]?.color[3] !== undefined ? defaultValue[selected].color[3] * 100 : undefined} min={0} max={100} size={size} onChange={next => write({ ...stop, color: [stop.color[0], stop.color[1], stop.color[2], clampParameter(next / 100)] })} />
    </div>}
  </div>
}
