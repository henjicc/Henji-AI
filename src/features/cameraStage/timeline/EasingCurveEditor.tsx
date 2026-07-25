import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { UiIconButton, UiOptionButton } from '@/components/ui'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import type { StageEasing } from '../domain/animationTypes'
import {
  beginHistorySession,
  endHistorySession,
  parseKeyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import {
  CURVE_PADDING,
  EASING_PRESETS,
  buildCurvePath,
  easingToHandles,
  handlesToEasing,
  normToSvg,
  svgToNorm,
  type CurveHandles,
} from './easingCurveGeometry'
import type { EasingEditTarget } from './timelineLayout'

/**
 * 速度曲线编辑弹层（3.3）：预设一键应用 + SVG 贝塞尔手柄拖拽 + 数值精确输入。
 * 编辑结果经 store.setKeyframesEasing 落地（天然可撤销/随工程持久化）；多选批量应用。
 */

const SIZE = 184
const POPOVER_WIDTH = 240

interface EasingCurveEditorProps {
  target: EasingEditTarget
  anchor: { x: number; y: number }
  onClose: () => void
}

function findEasing(
  target: EasingEditTarget,
  tracks: ReturnType<typeof useCameraStageStore.getState>['animation']['tracks'],
): StageEasing {
  const track = tracks.find((t) => t.objectId === target.objectId && t.propertyPath === target.path)
  const kf = track?.keyframes.find((k) => Math.abs(k.time - target.time) <= 1e-4)
  return kf?.easing ?? 'linear'
}

const EasingCurveEditor: React.FC<EasingCurveEditorProps> = ({ target, anchor, onClose }) => {
  const tracks = useCameraStageStore((state) => state.animation.tracks)
  const selectedKeyframes = useCameraStageStore((state) => state.selectedKeyframes)
  const setKeyframesEasing = useCameraStageStore((state) => state.setKeyframesEasing)
  const cardRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<'out' | 'in' | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => findEasing(target, tracks), [])
  const [handles, setHandles] = useState<CurveHandles>(() => easingToHandles(initial))
  const handlesRef = useRef(handles)
  handlesRef.current = handles
  const [kind, setKind] = useState<'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'custom'>(
    typeof initial === 'string' && initial !== 'hold' ? initial : 'custom',
  )

  // 批量目标：优先当前选中的全部关键帧，否则退回右键/双击的单个目标
  const applyTargets = useMemo(() => {
    const parsed = selectedKeyframes
      .map((key) => parseKeyframeKey(key))
      .filter((item): item is { objectId: string; path: string; time: number } => item !== null)
    return parsed.length > 0 ? parsed : [target]
  }, [selectedKeyframes, target])

  const applyEasing = (easing: StageEasing): void => {
    setKeyframesEasing(applyTargets, easing)
  }

  const handlePreset = (presetId: (typeof EASING_PRESETS)[number]['id']): void => {
    const next = easingToHandles(presetId)
    handlesRef.current = next
    setKind(presetId)
    setHandles(next)
    applyEasing(presetId)
  }

  const updateHandle = (which: 'out' | 'in', nx: number, ny: number): void => {
    const base = handlesRef.current
    const next: CurveHandles = { out: [...base.out], in: [...base.in] }
    next[which] = [nx, ny]
    handlesRef.current = next
    setHandles(next)
    setKind('custom')
    setKeyframesEasing(applyTargets, handlesToEasing(next))
  }

  const pointFromEvent = (event: React.PointerEvent | PointerEvent): { nx: number; ny: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return svgToNorm(event.clientX - rect.left, event.clientY - rect.top, SIZE)
  }

  const startDrag = (which: 'out' | 'in') => (event: React.PointerEvent<SVGCircleElement>): void => {
    event.stopPropagation()
    dragRef.current = which
    beginHistorySession()
    const point = pointFromEvent(event)
    if (point) updateHandle(which, point.nx, point.ny)
  }

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!dragRef.current) return
      const point = pointFromEvent(event)
      if (point) updateHandle(dragRef.current, point.nx, point.ny)
    }
    const onUp = (): void => {
      if (dragRef.current) {
        dragRef.current = null
        endHistorySession()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTargets])

  // 外部点击 / Esc 关闭
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - POPOVER_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 320))

  const outPt = normToSvg(handles.out[0], handles.out[1], SIZE)
  const inPt = normToSvg(handles.in[0], handles.in[1], SIZE)
  const startPt = normToSvg(0, 0, SIZE)
  const endPt = normToSvg(1, 1, SIZE)

  return (
    <div
      ref={cardRef}
      className="fixed z-dropdown rounded-lg border border-border-dark bg-surface-dark p-3 shadow-panel"
      style={{ left, top, width: POPOVER_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-dark">速度曲线</span>
        <UiIconButton showBorder={false} appearance="hover-only" className="h-5 w-5" title="关闭" onClick={onClose}>
          <X size={13} />
        </UiIconButton>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {EASING_PRESETS.map((preset) => (
          <UiOptionButton
            key={preset.id}
            active={kind === preset.id}
            className="px-2 py-1 text-xs"
            onClick={() => handlePreset(preset.id)}
          >
            {preset.label}
          </UiOptionButton>
        ))}
      </div>

      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        className="touch-none rounded-md"
        style={{ background: CAMERA_STAGE_TIMELINE_HEX.laneActive }}
      >
        <rect
          x={CURVE_PADDING}
          y={CURVE_PADDING}
          width={SIZE - CURVE_PADDING * 2}
          height={SIZE - CURVE_PADDING * 2}
          fill="none"
          stroke={CAMERA_STAGE_TIMELINE_HEX.laneBorder}
        />
        <line
          x1={startPt.x}
          y1={startPt.y}
          x2={outPt.x}
          y2={outPt.y}
          stroke={CAMERA_STAGE_TIMELINE_HEX.laneBorder}
        />
        <line
          x1={endPt.x}
          y1={endPt.y}
          x2={inPt.x}
          y2={inPt.y}
          stroke={CAMERA_STAGE_TIMELINE_HEX.laneBorder}
        />
        <path d={buildCurvePath(handles, SIZE)} fill="none" stroke={CAMERA_STAGE_TIMELINE_HEX.keyframeSelected} strokeWidth={2} />
        <circle cx={startPt.x} cy={startPt.y} r={3} fill={CAMERA_STAGE_TIMELINE_HEX.keyframe} />
        <circle cx={endPt.x} cy={endPt.y} r={3} fill={CAMERA_STAGE_TIMELINE_HEX.keyframe} />
        <circle
          cx={outPt.x}
          cy={outPt.y}
          r={6}
          className="cursor-grab"
          fill={CAMERA_STAGE_TIMELINE_HEX.playhead}
          onPointerDown={startDrag('out')}
        />
        <circle
          cx={inPt.x}
          cy={inPt.y}
          r={6}
          className="cursor-grab"
          fill={CAMERA_STAGE_TIMELINE_HEX.playhead}
          onPointerDown={startDrag('in')}
        />
      </svg>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <HandleInput label="出 X" value={handles.out[0]} min={0} max={1} onChange={(v) => updateHandle('out', v, handles.out[1])} />
        <HandleInput label="出 Y" value={handles.out[1]} min={-0.5} max={1.5} onChange={(v) => updateHandle('out', handles.out[0], v)} />
        <HandleInput label="入 X" value={handles.in[0]} min={0} max={1} onChange={(v) => updateHandle('in', v, handles.in[1])} />
        <HandleInput label="入 Y" value={handles.in[1]} min={-0.5} max={1.5} onChange={(v) => updateHandle('in', handles.in[0], v)} />
      </div>

      {applyTargets.length > 1 && (
        <div className="mt-2 text-2xs text-text-muted">批量应用到 {applyTargets.length} 个关键帧</div>
      )}
    </div>
  )
}

const HandleInput: React.FC<{
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}> = ({ label, value, min, max, onChange }) => (
  <div className="flex items-center gap-1">
    <span className="w-8 shrink-0 text-2xs text-text-muted">{label}</span>
    <NumberInput
      value={value}
      min={min}
      max={max}
      step={0.05}
      precision={2}
      widthClassName="w-full"
      className="min-w-0 flex-1"
      commitOnChange
      onChange={onChange}
    />
  </div>
)

export default EasingCurveEditor
