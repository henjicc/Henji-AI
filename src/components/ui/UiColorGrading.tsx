import { useRef } from 'react'
import { UI_COLOR_WHEEL_BACKGROUND } from './styleTokens'

interface GestureProps { onBegin: () => void; onFinish: () => void; onCancel: () => void; disabled?: boolean }
/** Five fixed input anchors; output is freely editable. Deliberately independent of document/undo ownership. */
export function UiToneCurve({ label, values, onChange, onBegin, onFinish, onCancel, disabled }: GestureProps & { label: string; values: readonly number[]; onChange: (point: number, value: number) => void }): React.ReactElement {
  const active = useRef<number | null>(null)
  const move = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (active.current === null) return
    const rect = event.currentTarget.getBoundingClientRect()
    onChange(active.current, Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100)))
  }
  return <svg viewBox="0 0 100 100" aria-label={label} className="aspect-square w-full touch-none rounded-control bg-control" onPointerMove={move}
    onPointerUp={event => { if (active.current === null) return; active.current = null; onFinish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { if (active.current !== null) { active.current = null; onCancel() } }}
    onLostPointerCapture={() => { if (active.current !== null) { active.current = null; onCancel() } }}
    onKeyDown={event => { if (event.key === 'Escape' && active.current !== null) { event.preventDefault(); event.stopPropagation(); active.current = null; onCancel() } }}>
    <path d="M0 100L100 0M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" className="stroke-line" fill="none" strokeWidth="0.5" />
    <polyline points={values.map((value, i) => `${i * 25},${100 - value}`).join(' ')} fill="none" className="stroke-accent" strokeWidth="1.5" />
    {values.map((value, i) => <circle key={i} cx={i * 25} cy={100 - value} r="3" className="fill-text1 stroke-control" tabIndex={disabled ? -1 : 0} role="slider" aria-label={`${label} · 输入 ${i * 25}%`} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-disabled={disabled}
      onPointerDown={event => { if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); active.current = i; onBegin(); event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId) }}
      onKeyDown={event => { if (disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); onChange(i, event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.max(0, Math.min(100, value + (event.key === 'ArrowUp' ? 1 : -1)))) }} />)}
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
