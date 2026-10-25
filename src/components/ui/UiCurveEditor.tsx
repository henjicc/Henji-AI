import { useMemo, useRef } from 'react'
import { clampParameter, parameterKeyStep, parameterPosition, useParameterGesture, type ParameterControlProps } from './parameterControl'
import { UI_CURVE_CHANNEL_COLOR, UI_PARAMETER_HANDLE_CLASS, UI_PARAMETER_HANDLE_RADIUS, UI_PARAMETER_SURFACE_CLASS, UI_PARAMETER_TRACK_BACKGROUND } from './styleTokens'

export interface UiCurvePoint { x: number; y: number }
export interface UiCurveEditorProps extends ParameterControlProps<UiCurvePoint[]> { kind?: 'tone' | 'hue'; channelColor?: keyof typeof UI_CURVE_CHANNEL_COLOR; /** Domain sampler in normalized coordinates; omitted for piecewise linear curves. */ sample?: (x: number) => number }

/** Pointer reach for grabbing an existing point, in normalized units (about 4% of the graph). */
const HIT_RADIUS = .04
/** Neighboring points keep a strictly increasing input. */
const GAP = .005
/**
 * 绘图区四周留出控制点半径的边距（viewBox 单位）：端点（0 / 1）的控制点完整画在框内、整颗可抓，
 * 不再伸出图外压到下一行控件上（重要记录 020）。
 */
const PAD = 5
const SPAN = 100 + PAD * 2

/**
 * Curve editing follows Photoshop/Lightroom/Lumetri: clicking the graph adds a point on the curve
 * (the curve does not change until it is dragged), dragging moves it between its neighbors,
 * double-click, Ctrl/⌘-click, Delete or dragging it out removes it; tone endpoints also move inward.
 * Linear by default; an optional domain sampler keeps the preview aligned with a spline renderer.
 */
export function UiCurveEditor(props: UiCurveEditorProps) {
  const { value, onChange, defaultValue, kind = 'tone', channelColor = 'master', disabled, size = 'sm' } = props
  const label = props['aria-label'] ?? props.label ?? '曲线'
  const gesture = useParameterGesture(props)
  const drag = useRef<{ index: number; points: UiCurvePoint[]; outside: boolean } | null>(null)
  const polyline = useMemo(() => (props.sample ? Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: props.sample!(i / 100) })) : value).map(point => `${point.x * 100},${(1 - point.y) * 100}`).join(' '), [value, props.sample])
  const curveAt = (x: number): number => {
    if (props.sample) return clampParameter(props.sample(x))
    const right = value.findIndex(point => point.x >= x)
    if (right <= 0) return value[right < 0 ? value.length - 1 : 0].y
    const left = value[right - 1]; const next = value[right]
    return left.y + (next.y - left.y) * (x - left.x) / (next.x - left.x)
  }
  const update = (points: UiCurvePoint[], index: number, point: UiCurvePoint): UiCurvePoint[] => {
    const endpoint = index === 0 || index === points.length - 1
    const low = index === 0 ? 0 : points[index - 1].x + GAP
    const high = index === points.length - 1 ? 1 : points[index + 1].x - GAP
    // Hue curves wrap around, so their endpoints stay at 0/1 and share one output.
    const x = kind === 'hue' && endpoint ? (index === 0 ? 0 : 1) : Math.min(high, Math.max(low, clampParameter(point.x)))
    const y = clampParameter(point.y)
    return points.map((entry, i) => i === index ? { x, y } : kind === 'hue' && endpoint && (i === 0 || i === points.length - 1) ? { ...entry, y } : entry)
  }
  const remove = (points: UiCurvePoint[], index: number) => index > 0 && index < points.length - 1 ? points.filter((_, i) => i !== index) : points
  // 去掉边距后按万分之一取整：换算带来的浮点尾差（0.24999999999999997）不写进曲线
  const inner = (value: number): number => Math.round((value * SPAN - PAD) * 100) / 1e4
  const pointerPoint = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => { const point = parameterPosition(event as React.PointerEvent<SVGSVGElement>); return { x: inner(point.x), y: 1 - inner(point.y) } }
  /** The point under the pointer: its own circle, or the nearest one within reach. */
  const pointAt = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): number => {
    const direct = Number((event.target as SVGElement).getAttribute('data-curve-point') ?? -1)
    if (direct >= 0) return direct
    const at = pointerPoint(event)
    let best = -1; let distance = HIT_RADIUS
    value.forEach((point, index) => { const d = Math.hypot(point.x - at.x, point.y - at.y); if (d <= distance) { best = index; distance = d } })
    return best
  }
  const reset = () => { if (defaultValue) gesture.atomic(() => onChange(defaultValue.map(point => ({ ...point })))) }
  const removeAt = (index: number) => { const next = remove(value, index); if (next !== value) gesture.atomic(() => onChange(next)) }
  // 色相底只铺在 0–1 的绘图区里（边距外仍是控件底），与曲线横轴对齐
  // icon-token-allow 用户控制点生成的曲线编辑图形，折线就是线性采样契约。
  return <svg viewBox={`${-PAD} ${-PAD} ${SPAN} ${SPAN}`} className={`${UI_PARAMETER_SURFACE_CLASS} aspect-square`} style={kind === 'hue' ? { backgroundImage: UI_PARAMETER_TRACK_BACKGROUND.hue, backgroundSize: `${100 / SPAN * 100}% ${100 / SPAN * 100}%`, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : undefined} role="group" aria-label={label} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
    {...gesture.handlers}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return
      let index = pointAt(event)
      if (index >= 0 && (event.ctrlKey || event.metaKey)) { removeAt(index); return }
      let points = value
      if (index < 0) {
        const x = clampParameter(pointerPoint(event).x)
        if (x <= GAP || x >= 1 - GAP || value.some(entry => Math.abs(entry.x - x) < GAP)) return
        // A new point lands on the current curve; only dragging bends it.
        const point = { x, y: curveAt(x) }
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
    onDoubleClick={event => { if (disabled) return; const index = pointAt(event); if (index >= 0) removeAt(index); else reset() }}
    onKeyDown={event => { if (event.key === 'Home' && defaultValue) { event.preventDefault(); reset() } }}>
    <path d="M0 0H100V100H0ZM25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" className="stroke-line" fill="none" strokeWidth=".5" pointerEvents="none" />
    <polyline points={polyline} fill="none" stroke={UI_CURVE_CHANNEL_COLOR[channelColor]} strokeWidth="1.5" pointerEvents="none" />
    {value.map((point, index) => <circle key={index} data-curve-point={index} cx={point.x * 100} cy={(1 - point.y) * 100} r={UI_PARAMETER_HANDLE_RADIUS[size]} className={UI_PARAMETER_HANDLE_CLASS}
      role="slider" aria-label={`${label}点${index + 1}`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={point.y} aria-valuetext={`输入${point.x}，输出${point.y}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onKeyDown={event => {
        const delta = parameterKeyStep(event.key, event.shiftKey, .01)
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); const next = remove(value, index); if (next !== value) gesture.atomic(() => onChange(next)); return }
        if (!delta) return
        event.preventDefault(); event.stopPropagation(); gesture.atomic(() => onChange(update(value, index, { x: point.x + (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? delta : 0), y: point.y + (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? delta : 0) })))
      }} onContextMenu={event => { event.preventDefault(); const next = remove(value, index); if (!disabled && next !== value) gesture.atomic(() => onChange(next)) }} />)}
  </svg>
}
