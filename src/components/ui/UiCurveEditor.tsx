import { useMemo, useRef } from 'react'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_CURVE_CHANNEL_COLOR, UI_PARAMETER_HANDLE_CLASS, UI_PARAMETER_HANDLE_RADIUS, UI_PARAMETER_SURFACE_CLASS, UI_PARAMETER_TRACK_BACKGROUND } from './styleTokens'

export interface UiCurvePoint { x: number; y: number }
export interface UiCurveEditorProps extends ParameterControlProps<UiCurvePoint[]> { kind?: 'tone' | 'hue'; channelColor?: keyof typeof UI_CURVE_CHANNEL_COLOR }

/** Linear segments exactly represent piecewise linear sampling; no resampling table or spline overshoot. */
export function UiCurveEditor(props: UiCurveEditorProps) {
  const { value, onChange, defaultValue, kind = 'tone', channelColor = 'master', disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '曲线'
  const gesture = useParameterGesture(props)
  const drag = useRef<{ index: number; points: UiCurvePoint[]; outside: boolean } | null>(null)
  const polyline = useMemo(() => value.map(point => `${point.x * 100},${(1 - point.y) * 100}`).join(' '), [value])
  const update = (points: UiCurvePoint[], index: number, point: UiCurvePoint): UiCurvePoint[] => {
    const endpoint = index === 0 || index === points.length - 1
    const candidate = clampParameter(point.x)
    const x = endpoint ? (index === 0 ? 0 : 1) : candidate > points[index - 1].x && candidate < points[index + 1].x ? candidate : points[index].x
    const y = clampParameter(point.y)
    return points.map((entry, i) => i === index ? { x, y } : kind === 'hue' && endpoint && (i === 0 || i === points.length - 1) ? { ...entry, y } : entry)
  }
  const remove = (points: UiCurvePoint[], index: number) => index > 0 && index < points.length - 1 ? points.filter((_, i) => i !== index) : points
  const pointerPoint = (event: React.PointerEvent<SVGSVGElement>) => { const point = parameterPosition(event); return { x: point.x, y: 1 - point.y } }
  // icon-token-allow 用户控制点生成的曲线编辑图形，折线就是线性采样契约。
  return <svg viewBox="0 0 100 100" className={`${UI_PARAMETER_SURFACE_CLASS} aspect-square overflow-visible`} style={kind === 'hue' ? { background: UI_PARAMETER_TRACK_BACKGROUND.hue } : undefined} role="group" aria-label={label} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
    {...gesture.handlers}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return
      const target = event.target as SVGElement
      let index = Number(target.getAttribute('data-curve-point') ?? -1)
      let points = value
      if (index < 0) {
        const point = pointerPoint(event); point.x = clampParameter(point.x); point.y = clampParameter(point.y)
        if (point.x === 0 || point.x === 1 || value.some(entry => Math.abs(entry.x - point.x) < .000001)) return
        points = [...value, point].sort((a, b) => a.x - b.x); index = points.indexOf(point)
      }
      if (!gesture.begin(event)) return
      drag.current = { index, points, outside: false }
      if (points !== value) onChange(points)
      else event.currentTarget.querySelector<SVGElement>(`[data-curve-point="${index}"]`)?.focus()
    }}
    onPointerMove={event => {
      const current = drag.current
      if (!gesture.active(event) || !current) return
      const point = pointerPoint(event)
      current.outside = point.x < -.05 || point.x > 1.05 || point.y < -.05 || point.y > 1.05
      current.points = update(current.points, current.index, point); onChange(current.points)
    }}
    onPointerUp={event => {
      const current = drag.current
      if (gesture.active(event) && current?.outside) { const next = remove(current.points, current.index); if (next !== current.points) onChange(next) }
      drag.current = null; gesture.handlers.onPointerUp(event)
    }}
    onDoubleClick={() => { if (defaultValue) gesture.atomic(() => onChange(defaultValue.map(point => ({ ...point })))) }}
    onKeyDown={event => { if (event.key === 'Home' && defaultValue) { event.preventDefault(); gesture.atomic(() => onChange(defaultValue.map(point => ({ ...point })))) } }}>
    <path d="M0 0H100V100H0ZM25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" className="stroke-line" fill="none" strokeWidth=".5" pointerEvents="none" />
    <polyline points={polyline} fill="none" stroke={UI_CURVE_CHANNEL_COLOR[channelColor]} strokeWidth="1.5" pointerEvents="none" />
    {value.map((point, index) => <circle key={index} data-curve-point={index} cx={point.x * 100} cy={(1 - point.y) * 100} r={UI_PARAMETER_HANDLE_RADIUS[size]} className={UI_PARAMETER_HANDLE_CLASS}
      role="slider" aria-label={`${label}点${index + 1}`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={point.y} aria-valuetext={`输入${point.x}，输出${point.y}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onKeyDown={event => {
        const delta = parameterKeyStep(event.key, event.shiftKey, .01)
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); const next = remove(value, index); if (next !== value) gesture.atomic(() => onChange(next)); return }
        if (!delta) return
        event.preventDefault(); event.stopPropagation(); gesture.atomic(() => onChange(update(value, index, { x: point.x + (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? delta : 0), y: point.y + (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? delta : 0) })))
      }} />)}
  </svg>
}
