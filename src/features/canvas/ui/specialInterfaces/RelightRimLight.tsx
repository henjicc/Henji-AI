import { useId, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { UI_FIELD_FOCUS_CLASS } from '@/components/ui/styleTokens'
import type { RelightVisualizerView } from './relightDirectionVisualizerState'
import {
  RIM_DIRECTION_LABELS, RIM_DIRECTION_ORDER, rimAngleForDirection,
  rimAngleFromPoint, rimDirectionFromAngle, rimPointForAngle, type EnabledRimDirection,
} from './relightRimLightState'

interface Props {
  direction: EnabledRimDirection
  view: RelightVisualizerView
  lightColor: string
  intensity: number
  stageRef: RefObject<HTMLDivElement>
  onChange: (direction: EnabledRimDirection) => void
}

export function RelightRimLight({ direction, view, lightColor, intensity, stageRef, onChange }: Props): JSX.Element {
  const id = useId().replace(/:/g, '')
  const [draftAngle, setDraftAngle] = useState<number | null>(null)
  const angleRef = useRef<number | null>(null)
  const pointerId = useRef<number | null>(null)
  const angle = draftAngle ?? rimAngleForDirection(direction)
  const previewDirection = rimDirectionFromAngle(angle)
  const point = rimPointForAngle(angle, view)
  const x = 50 + point.x * 43
  const y = 50 + point.y * 43
  const length = Math.max(Math.hypot(point.x, point.y), 0.01)
  // 光锥落在主体外围，且比主光窄、弱；只用于表现轮廓光意图。
  const targetX = 50 + point.x / length * 13
  const targetY = 50 + point.y / length * 10
  const nx = -point.y / length * 5
  const ny = point.x / length * 5
  const reset = (): void => {
    pointerId.current = null
    angleRef.current = null
    setDraftAngle(null)
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointerId.current !== event.pointerId) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const next = rimAngleFromPoint({
      x: (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.43),
      y: (event.clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.43),
    }, view)
    if (next === null) return
    angleRef.current = next
    setDraftAngle(next)
  }
  return <div className="pointer-events-none absolute inset-0 z-sticky" data-relight-rim-light={previewDirection}>
    {/* icon-token-allow：轮廓光锥与灯位由拖动方位实时计算，属于数据图形。 */}
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-beam`} gradientUnits="userSpaceOnUse" x1={x} y1={y} x2={targetX} y2={targetY}>
          <stop offset="0" stopColor={lightColor} stopOpacity={intensity * 0.65} />
          <stop offset="1" stopColor={lightColor} stopOpacity={intensity * 0.08} />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor={lightColor} stopOpacity={intensity * 0.6} />
          <stop offset="1" stopColor={lightColor} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
      </defs>
      <polygon points={`${x},${y} ${targetX + nx},${targetY + ny} ${targetX - nx},${targetY - ny}`}
        fill={`url(#${id}-beam)`} filter={`url(#${id}-soft)`} />
      <circle cx={targetX} cy={targetY} r="7" fill={`url(#${id}-halo)`} />
      <circle cx={x} cy={y} r="6" fill={`url(#${id}-halo)`} />
      <circle cx={x} cy={y} r="2" fill={lightColor} className="stroke-veil-bright" strokeWidth="0.35" />
      <circle cx={x} cy={y} r="3" fill="none" className="stroke-veil-soft" strokeWidth="0.4" strokeDasharray="1 1" />
    </svg>
    <div role="slider" tabIndex={0} aria-label="轮廓光方向"
      aria-valuemin={0} aria-valuemax={7} aria-valuenow={RIM_DIRECTION_ORDER.indexOf(previewDirection)}
      aria-valuetext={RIM_DIRECTION_LABELS[previewDirection]}
      title={`轮廓光 · ${RIM_DIRECTION_LABELS[previewDirection]}`}
      data-relight-rim-control="true"
      className={`nodrag nowheel pointer-events-auto absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full ${UI_FIELD_FOCUS_CLASS} ${draftAngle === null ? 'cursor-grab' : 'cursor-grabbing'}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointerId.current !== null) return
        event.stopPropagation()
        event.preventDefault()
        event.currentTarget.focus()
        pointerId.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        if (pointerId.current !== event.pointerId) return
        const next = angleRef.current === null ? direction : rimDirectionFromAngle(angleRef.current)
        reset()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (next !== direction) onChange(next)
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); reset(); return }
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!delta && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        event.stopPropagation()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 7
          : (RIM_DIRECTION_ORDER.indexOf(direction) + delta + 8) % 8
        reset()
        onChange(RIM_DIRECTION_ORDER[index])
      }}
    />
  </div>
}
