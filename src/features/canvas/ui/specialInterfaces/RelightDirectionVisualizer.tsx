import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { UiChipButton } from '@/components/ui/primitives'
import { UI_LIGHTING_COLORS, UI_TEXT_LABEL_CLASS } from '@/components/ui/styleTokens'
import type { RelightBrightness, RelightColorPreset, RelightKeyDirection, RelightRimDirection } from '@/features/canvas/capabilities/relightPolicy'
import { RELIGHT_DIRECTION_LABELS, RELIGHT_DIRECTION_ORDER, type RelightVisualizerView } from './relightDirectionVisualizerState'
import { RIM_DIRECTION_LABELS, RIM_DIRECTION_ORDER } from './relightRimLightState'
import { RelightSpatialScene } from './RelightSpatialScene'
import { snapLightAtPoint, lightPosition, mainDirectionForPose, poseForMain, poseForRim,
  projectSpatialPoint, rimDirectionForPose, type RelightSpatialState } from './relightSpatialState'

interface Props {
  direction: RelightKeyDirection
  brightness?: RelightBrightness
  colorPreset?: RelightColorPreset
  rimDirection?: RelightRimDirection
  onRimDirectionChange?: (direction: RelightRimDirection) => void
  sourceImage: string | null
  sourceAlt: string
  onDirectionChange: (direction: RelightKeyDirection) => void
}

export function RelightDirectionVisualizer({ direction, brightness = 0, colorPreset = 'neutral', rimDirection = 'off',
  onRimDirectionChange, sourceImage, sourceAlt, onDirectionChange }: Props): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<RelightVisualizerView>('perspective')
  const [poses, setPoses] = useState(() => ({ main: poseForMain(direction), rim: poseForRim(rimDirection) }))
  const posesRef = useRef(poses)
  const previous = useRef({ direction, rimDirection })
  const drag = useRef<{ id: number; lamp: 'main' | 'rim'; left: number; top: number; size: number; start: RelightSpatialState } | null>(null)
  const [dragging, setDragging] = useState(false)
  const setPosition = (next: RelightSpatialState): void => { posesRef.current = next; setPoses(next) }

  useEffect(() => {
    const old = previous.current
    previous.current = { direction, rimDirection }
    if (drag.current) return
    setPosition({ main: old.direction !== direction ? poseForMain(direction) : posesRef.current.main,
      rim: rimDirection !== 'off' && rimDirectionForPose(posesRef.current.rim) !== rimDirection
        ? poseForRim(rimDirection) : posesRef.current.rim })
  }, [direction, rimDirection])

  const commit = (next: RelightSpatialState, lamp: 'main' | 'rim', main = mainDirectionForPose(next.main), rim = rimDirectionForPose(next.rim)): void => {
    setPosition(next)
    const nextMain = lamp === 'main' ? main : direction
    const nextRim = lamp === 'rim' ? rim : rimDirection
    previous.current = { direction: nextMain, rimDirection: nextRim }
    if (lamp === 'main') onDirectionChange(nextMain)
    else onRimDirectionChange?.(nextRim)
  }
  const cancel = (): void => {
    if (drag.current) setPosition(drag.current.start)
    drag.current = null
    setDragging(false)
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    const pose = snapLightAtPoint((event.clientX - active.left) / active.size * 100,
      (event.clientY - active.top) / active.size * 100, active.lamp, view)
    const old = posesRef.current[active.lamp]
    if (old.azimuth !== pose.azimuth || old.elevation !== pose.elevation)
      setPosition({ ...posesRef.current, [active.lamp]: pose })
  }
  const control = (lamp: 'main' | 'rim'): JSX.Element => {
    const isMain = lamp === 'main'
    const point = projectSpatialPoint(lightPosition(poses[lamp]), view)
    const currentMain = mainDirectionForPose(poses.main)
    const currentRim = rimDirectionForPose(poses.rim)
    return <div key={lamp} role="slider" tabIndex={0} aria-label={isMain ? '主光方向' : '轮廓光方向'}
      aria-valuemin={0} aria-valuemax={isMain ? 4 : 7}
      aria-valuenow={isMain ? RELIGHT_DIRECTION_ORDER.indexOf(currentMain) : RIM_DIRECTION_ORDER.indexOf(currentRim)}
      aria-valuetext={isMain ? RELIGHT_DIRECTION_LABELS[currentMain] : RIM_DIRECTION_LABELS[currentRim]}
      data-relight-direction-control={isMain ? 'true' : undefined} data-relight-direction={isMain ? currentMain : undefined}
      data-relight-brightness={isMain ? brightness : undefined} data-relight-color={isMain ? colorPreset : undefined}
      data-relight-rim-control={!isMain ? 'true' : undefined} data-relight-rim-light={!isMain ? currentRim : undefined}
      data-light-z={lightPosition(poses[lamp]).z}
      title={isMain ? '拖动选择高亮灯位；方向键调整，Home 不指定方向' : '拖动选择图片背后的轮廓光方位；方向键调整'}
      className={`nodrag nowheel absolute touch-none outline-none ${!dragging ? 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent' : ''} ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${isMain ? 'inset-0 rounded-lg' : 'h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full'}`}
      style={isMain ? undefined : { left: `${point.x}%`, top: `${point.y}%` }}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault(); event.stopPropagation()
        const bounds = stageRef.current?.getBoundingClientRect()
        drag.current = { id: event.pointerId, lamp, left: bounds?.left ?? 0, top: bounds?.top ?? 0,
          size: Math.max(bounds?.width ?? 1, 1), start: posesRef.current }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }} onPointerMove={move}
      onPointerUp={event => {
        const active = drag.current
        if (!active || active.id !== event.pointerId) return
        const next = posesRef.current
        drag.current = null; setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        commit(next, lamp)
      }} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
        if (!['Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        if (isMain) {
          const directions: Record<string, RelightKeyDirection> = { Home: 'none', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }
          const next = directions[event.key]
          commit({ ...posesRef.current, main: poseForMain(next) }, lamp, next)
        } else {
          const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
          const next = RIM_DIRECTION_ORDER[event.key === 'Home' ? 0 : (RIM_DIRECTION_ORDER.indexOf(currentRim) + delta + 8) % 8]
          commit({ ...posesRef.current, rim: poseForRim(next) }, lamp, direction, next)
        }
      }} />
  }
  return <section className="flex min-h-0 min-w-0 w-full flex-col gap-2">
    <div className="flex shrink-0 items-center justify-between gap-2">
      <h3 className={UI_TEXT_LABEL_CLASS}>主光方向</h3>
      <div className="grid grid-cols-2 gap-1">
        {(['perspective', 'front'] as const).map(value => <UiChipButton key={value} type="button" selectionRole="navigation"
          active={view === value} className="!h-8 justify-center !px-3 !py-0 text-xs" onClick={() => setView(value)}>
          {value === 'perspective' ? '透视' : '正面'}
        </UiChipButton>)}
      </div>
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
      <div ref={stageRef} style={{ width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' }}
        className="relative shrink-0 select-none overflow-hidden rounded-lg text-veil-subtle">
        <RelightSpatialScene main={poses.main} rim={rimDirection === 'off' ? null : poses.rim} view={view}
          activeLamp={dragging ? drag.current?.lamp : undefined} mainEnabled={(mainDirectionForPose(poses.main)) !== 'none'}
          color={UI_LIGHTING_COLORS[colorPreset]} intensity={(brightness + 3) / 5} sourceImage={sourceImage} sourceAlt={sourceAlt} />
        {control('main')}
        {rimDirection !== 'off' && onRimDirectionChange ? control('rim') : null}
      </div>
    </div>
  </section>
}
