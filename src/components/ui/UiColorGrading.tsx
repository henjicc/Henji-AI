import { colorGradeSpline, type ColorGradeCurvePoint } from '@/core/videoEdit/colorGradeCurves'
import { useRef } from 'react'
import { UI_COLOR_WHEEL_BACKGROUND } from './styleTokens'

export interface GestureProps { onBegin: () => void; onFinish: () => void; onCancel: () => void; disabled?: boolean }
/** Document/undo independent curve editor; legacy values remain supported by existing consumers. */
export function UiToneCurve({ label, values, points, onChange, onPointsChange, onBegin, onFinish, onCancel, disabled }: GestureProps & { label: string; values?: readonly number[]; points?: readonly ColorGradeCurvePoint[]; onChange?: (point: number, value: number) => void; onPointsChange?: (points: ColorGradeCurvePoint[]) => void }): React.ReactElement {
  const current = points ?? (values ?? []).map((y, i) => ({ x: i * 25, y }))
  const active = useRef<{ index: number; points: ColorGradeCurvePoint[]; outside: boolean } | null>(null)
  const pointAt = (event: React.PointerEvent<SVGSVGElement>): ColorGradeCurvePoint => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width * 100, y: 100 - (event.clientY - rect.top) / rect.height * 100 }
  }
  const write = (next: ColorGradeCurvePoint[], index: number): void => { if (onPointsChange) onPointsChange(next); else onChange?.(index, next[index].y) }
  const remove = (index: number): void => { if (!disabled && onPointsChange && current.length > 2) onPointsChange(current.filter((_, i) => i !== index)) }
  const move = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = active.current; if (!drag) return
    const point = pointAt(event); const index = drag.index
    drag.outside = point.x < -5 || point.x > 105 || point.y < -5 || point.y > 105
    const x = onPointsChange ? Math.max(index ? drag.points[index - 1].x + .01 : 0, Math.min(index < drag.points.length - 1 ? drag.points[index + 1].x - .01 : 100, point.x)) : drag.points[index].x
    const next = drag.points.map((p, i) => i === index ? { x, y: Math.max(0, Math.min(100, point.y)) } : p)
    drag.points = next; write(next, index)
  }
  const evaluate = current.length >= 2 ? colorGradeSpline(current) : () => 0
  return <svg viewBox="0 0 100 100" aria-label={label} tabIndex={disabled ? -1 : 0} className="aspect-square w-full touch-none rounded-control bg-control"
    onPointerDown={event => {
      if (disabled || event.button !== 0 || !onPointsChange || event.target !== event.currentTarget) return
      const point = pointAt(event); point.x = Math.max(0, Math.min(100, point.x)); point.y = Math.max(0, Math.min(100, point.y))
      if (current.some(p => Math.abs(p.x - point.x) < .01)) return
      const next = [...current, point].sort((a, b) => a.x - b.x); const index = next.indexOf(point)
      onBegin(); active.current = { index, points: next, outside: false }; onPointsChange(next); event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={move}
    onPointerUp={event => { const drag = active.current; if (!drag) return; active.current = null; if (drag.outside && onPointsChange && drag.points.length > 2) onPointsChange(drag.points.filter((_, i) => i !== drag.index)); onFinish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { if (active.current) { active.current = null; onCancel() } }}
    onLostPointerCapture={() => { if (active.current) { active.current = null; onCancel() } }}
    onKeyDown={event => { if (event.key === 'Escape' && active.current) { event.preventDefault(); event.stopPropagation(); active.current = null; onCancel() } }}>
    <path pointerEvents="none" d="M0 100L100 0M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" className="stroke-line" fill="none" strokeWidth="0.5" />
    <polyline pointerEvents="none" points={Array.from({ length: 101 }, (_, x) => `${x},${100 - evaluate(x)}`).join(' ')} fill="none" className="stroke-accent" strokeWidth="1.5" />
    {current.map((point, i) => <circle key={i} cx={point.x} cy={100 - point.y} r="3" className="fill-text1 stroke-control" tabIndex={disabled ? -1 : 0} role="slider" aria-label={`${label} · 输入 ${Math.round(point.x * 100) / 100}%`} aria-valuenow={Math.round(point.y)} aria-valuemin={0} aria-valuemax={100} aria-disabled={disabled}
      onContextMenu={event => { event.preventDefault(); remove(i) }}
      onPointerDown={event => { if (disabled || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); active.current = { index: i, points: current.map(p => ({ ...p })), outside: false }; onBegin(); event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId) }}
      onKeyDown={event => {
        if (disabled) return
        if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); remove(i); return }
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const x = !onPointsChange ? point.x : Math.max(i ? current[i - 1].x + .01 : 0, Math.min(i < current.length - 1 ? current[i + 1].x - .01 : 100, point.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)))
        const y = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.max(0, Math.min(100, point.y + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0)))
        write(current.map((p, index) => index === i ? { x, y } : p), i)
      }} />)}
  </svg>
}

/** Hue in degrees and tint strength in percent; pointer or arrow keys, Home resets to neutral. */
export function UiColorWheel({ label, hue, strength, onChange, onBegin, onFinish, onCancel, disabled }: GestureProps & { label: string; hue: number; strength: number; onChange: (hue: number, strength: number) => void }): React.ReactElement {
  const dragging = useRef(false)
  const set = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width * 2 - 1; const y = (event.clientY - rect.top) / rect.height * 2 - 1
    onChange((Math.atan2(y, x) * 180 / Math.PI + 360) % 360, Math.min(100, Math.hypot(x, y) * 100))
  }
  const angle = hue * Math.PI / 180
  return <div role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(strength)} aria-valuetext={`${Math.round(hue)}度，染色${Math.round(strength)}%`} aria-disabled={disabled}
    className="relative aspect-square w-full touch-none rounded-full" style={{ background: UI_COLOR_WHEEL_BACKGROUND }}
    onPointerDown={event => { if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); dragging.current = true; onBegin(); event.currentTarget.setPointerCapture(event.pointerId); set(event) }}
    onPointerMove={event => { if (dragging.current) set(event) }}
    onPointerUp={event => { if (!dragging.current) return; dragging.current = false; onFinish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { if (dragging.current) { dragging.current = false; onCancel() } }}
    onLostPointerCapture={() => { if (dragging.current) { dragging.current = false; onCancel() } }}
    onKeyDown={event => { if (event.key === 'Escape' && dragging.current) { event.preventDefault(); event.stopPropagation(); dragging.current = false; onCancel() } else if (!disabled && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) { event.preventDefault(); onChange(event.key === 'Home' ? 0 : (hue + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) + 360) % 360, event.key === 'Home' ? 0 : Math.max(0, Math.min(100, strength + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0)))) } }}>
    <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-on-media bg-media" style={{ left: `${50 + Math.cos(angle) * strength / 2}%`, top: `${50 + Math.sin(angle) * strength / 2}%` }} />
  </div>
}
