import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleOff, SunMedium } from 'lucide-react'

import { UiChipButton, UiOptionButton } from '@/components/ui/primitives'
import {
  UI_FIELD_FOCUS_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_LABEL_CLASS,
} from '@/components/ui/styleTokens'
import type { RelightKeyDirection } from '@/features/canvas/capabilities/relightPolicy'
import {
  RELIGHT_DIRECTION_LABELS,
  RELIGHT_DIRECTION_ORDER,
  clampRelightDirectionPoint,
  relightDirectionFromPoint,
  relightPointForDirection,
  type RelightDirectionPoint,
  type RelightVisualizerView,
} from './relightDirectionVisualizerState'

const DIRECTION_ICONS = {
  none: CircleOff, left: ArrowLeft, right: ArrowRight, top: ArrowUp, bottom: ArrowDown,
} satisfies Record<RelightKeyDirection, typeof ArrowLeft>

function stagePoint(event: PointerEvent<HTMLDivElement>): RelightDirectionPoint {
  const bounds = event.currentTarget.getBoundingClientRect()
  const halfSize = Math.max(Math.min(bounds.width, bounds.height) / 2, 1)
  return clampRelightDirectionPoint({
    x: (event.clientX - bounds.left - bounds.width / 2) / halfSize,
    y: (event.clientY - bounds.top - bounds.height / 2) / halfSize,
  })
}

function beamPoints(point: RelightDirectionPoint): string {
  const sourceX = 50 + point.x * 43
  const sourceY = 50 + point.y * 43
  const dx = 50 - sourceX
  const dy = 50 - sourceY
  const length = Math.max(Math.hypot(dx, dy), 1)
  const normalX = (-dy / length) * 8
  const normalY = (dx / length) * 8
  return `${sourceX},${sourceY} ${50 + normalX},${50 + normalY} ${50 - normalX},${50 - normalY}`
}

interface RelightDirectionVisualizerProps {
  direction: RelightKeyDirection
  sourceImage: string | null
  sourceAlt: string
  onDirectionChange: (direction: RelightKeyDirection) => void
}

export function RelightDirectionVisualizer({
  direction,
  sourceImage,
  sourceAlt,
  onDirectionChange,
}: RelightDirectionVisualizerProps): JSX.Element {
  const [view, setView] = useState<RelightVisualizerView>('perspective')
  const [point, setPoint] = useState(() => relightPointForDirection(direction, 'perspective'))
  const [dragging, setDragging] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const mappedDirection = useRef(direction)

  useEffect(() => {
    mappedDirection.current = direction
    if (!dragging) setPoint(relightPointForDirection(direction, view))
  }, [direction, dragging, view])

  const handleDirection = (next: RelightKeyDirection): void => {
    if (mappedDirection.current === next) return
    mappedDirection.current = next
    onDirectionChange(next)
  }

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const nextPoint = stagePoint(event)
    setPoint(nextPoint)
    handleDirection(relightDirectionFromPoint(nextPoint))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    activePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    updateFromPointer(event)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (activePointerId.current !== event.pointerId) return
    updateFromPointer(event)
  }

  const finishPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (activePointerId.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointerId.current = null
    setDragging(false)
  }

  const chooseDirection = (next: RelightKeyDirection): void => {
    setPoint(relightPointForDirection(next, view))
    handleDirection(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keyDirections: Partial<Record<string, RelightKeyDirection>> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'top',
      ArrowDown: 'bottom',
      Home: 'none',
    }
    const next = keyDirections[event.key]
    if (!next) return
    event.preventDefault()
    chooseDirection(next)
  }

  const visualPoint = useMemo(() => ({
    x: 50 + point.x * 43,
    y: 50 + point.y * 43,
  }), [point])
  const showBeam = direction !== 'none' || dragging

  return (
    <section className="flex min-h-0 min-w-0 w-full flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className={UI_TEXT_LABEL_CLASS}>主光方向</h3>
        <div className="grid grid-cols-2 gap-1">
        <UiChipButton
          type="button"
          selectionRole="navigation"
          active={view === 'perspective'}
          className="!h-8 justify-center !px-3 !py-0 text-xs"
          onClick={() => setView('perspective')}
        >
          透视
        </UiChipButton>
        <UiChipButton
          type="button"
          selectionRole="navigation"
          active={view === 'front'}
          className="!h-8 justify-center !px-3 !py-0 text-xs"
          onClick={() => setView('front')}
        >
          正面
        </UiChipButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
      <div
        role="slider"
        tabIndex={0}
        aria-label="主光方向"
        aria-valuemin={0}
        aria-valuemax={RELIGHT_DIRECTION_ORDER.length - 1}
        aria-valuenow={RELIGHT_DIRECTION_ORDER.indexOf(direction)}
        aria-valuetext={RELIGHT_DIRECTION_LABELS[direction]}
        data-relight-direction-control="true"
        data-relight-direction={direction}
        style={{ width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' }}
        className={`relative shrink-0 touch-none select-none overflow-hidden rounded-lg text-veil-subtle ${UI_FIELD_FOCUS_CLASS} ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {/* icon-token-allow：球面网格、光束与拖拽灯位由当前参数实时生成，是交互数据图形而非图标。 */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="42" className="fill-surface-dark/70 stroke-veil-subtle" />
          <ellipse cx="50" cy="50" rx="42" ry={view === 'perspective' ? 14 : 19} fill="none" stroke="currentColor" strokeWidth="0.45" />
          <ellipse cx="50" cy="50" rx={view === 'perspective' ? 18 : 1} ry="42" fill="none" stroke="currentColor" strokeWidth="0.45" />
          <path d="M 8 50 H 92 M 50 8 V 92" fill="none" stroke="currentColor" strokeWidth="0.35" strokeDasharray="1.5 3" />
          {showBeam ? <polygon points={beamPoints(point)} className="fill-veil-soft" /> : null}
          {showBeam ? <line x1={visualPoint.x} y1={visualPoint.y} x2="50" y2="50" className="stroke-veil-bright" strokeWidth="0.65" /> : null}
        </svg>

        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 z-raised aspect-[4/3] w-[42%] overflow-hidden rounded-md border border-veil-soft bg-surface-dark ${view === 'perspective' ? '[transform:translate(-50%,-50%)_perspective(360px)_rotateY(-28deg)_rotateZ(4deg)]' : '-translate-x-1/2 -translate-y-1/2'}`}
        >
          {sourceImage ? (
            <img src={sourceImage} alt={sourceAlt} className="h-full w-full object-contain" draggable={false} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-muted">
              <SunMedium className="h-5 w-5" />
            </span>
          )}
        </div>

        {/* icon-token-allow：灯位光点的位置由拖拽参数实时生成，是交互数据标记而非图标。 */}
        <svg className="pointer-events-none absolute inset-0 z-sticky h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx={visualPoint.x} cy={visualPoint.y} r="4.8" className="fill-veil-soft" />
          <circle cx={visualPoint.x} cy={visualPoint.y} r="3" className="fill-text-dark stroke-app" strokeWidth="0.8" />
          <circle cx={visualPoint.x} cy={visualPoint.y} r="1" className="fill-accent" />
        </svg>
      </div>

      </div>
      <div className="grid shrink-0 grid-cols-5 gap-1" role="group" aria-label="主光方向预设">
        {RELIGHT_DIRECTION_ORDER.map((value) => {
          const Icon = DIRECTION_ICONS[value]
          return (
            <UiOptionButton
              key={value}
              variant="menu"
              active={direction === value}
              aria-pressed={direction === value}
              className="!h-8 justify-center gap-1 whitespace-nowrap !px-1 !py-0 text-2xs"
              onClick={() => chooseDirection(value)}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {RELIGHT_DIRECTION_LABELS[value]}
            </UiOptionButton>
          )
        })}
      </div>
      <p className={`${UI_TEXT_META_CLASS} shrink-0 text-center`}>拖动光点或选择方向，调整主光位置</p>
    </section>
  )
}
