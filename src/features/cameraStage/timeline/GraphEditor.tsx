import React, { useEffect, useRef } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { easeProgress } from '../domain/keyframeEngine'
import type { StageEasing, StageKeyframe, StageTrack } from '../domain/animationTypes'
import {
  beginHistorySession,
  endHistorySession,
  keyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import { timeToX, xToTime } from './timeScale'
import { axisColor } from './graphColors'
import {
  valueGridTicks,
  valueToY,
  yToValue,
  type ValueRange,
} from './graphGeometry'
import { easingToHandles } from './easingCurveGeometry'
import type { EasingEditTarget } from './timelineLayout'

/**
 * AE 风格速度图表编辑器：纵轴显示速度（单位/秒），关键帧可横向改时间，
 * 端点速度手柄可横向调影响、纵向调速度，并写回关键帧段 easing。
 */

export interface GraphTrack {
  objectId: string
  path: string
  label: string
  track: StageTrack
}

interface GraphEditorProps {
  tracks: GraphTrack[]
  pxPerSecond: number
  contentWidth: number
  height: number
  duration: number
  fps: number
  selectedKeys: ReadonlySet<string>
  onOpenEasing: (target: EasingEditTarget, anchor: { x: number; y: number }) => void
}

interface SpeedDragContext {
  kind: 'keyframe' | 'handle'
  pointerId?: number
  objectId: string
  path: string
  segmentStartTime: number
  movingKeyTime?: number
  endpoint: 'out' | 'in'
  t0: number
  v0: number
  t1: number
  v1: number
  easing: StageEasing
  valueRange: ValueRange
  graphHeight: number
}

interface PointerPoint {
  clientX: number
  clientY: number
  altKey: boolean
}

const SPEED_EPSILON = 1e-6
const HANDLE_MIN_INFLUENCE = 0.02
const HANDLE_MAX_INFLUENCE = 0.98

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function snap(time: number, duration: number, fps: number, free: boolean): number {
  const clamped = Math.max(0, Math.min(duration, time))
  return free || fps <= 0 ? clamped : Math.round(clamped * fps) / fps
}

function segmentBaseSpeed(a: StageKeyframe, b: StageKeyframe): number {
  const span = Math.max(SPEED_EPSILON, b.time - a.time)
  return Math.abs(((b.value as number) - (a.value as number)) / span)
}

function speedAtSegment(a: StageKeyframe, b: StageKeyframe, u: number): number {
  const h = 0.001
  const lo = Math.max(0, u - h)
  const hi = Math.min(1, u + h)
  const span = Math.max(SPEED_EPSILON, hi - lo)
  const delta = easeProgress(a.easing, hi) - easeProgress(a.easing, lo)
  return segmentBaseSpeed(a, b) * Math.abs(delta / span)
}

function endpointSpeed(easing: StageEasing, baseSpeed: number, endpoint: 'out' | 'in'): number {
  const handles = easingToHandles(easing)
  if (endpoint === 'out') {
    const x = Math.max(SPEED_EPSILON, handles.out[0])
    return baseSpeed * Math.abs(handles.out[1] / x)
  }
  const x = Math.max(SPEED_EPSILON, 1 - handles.in[0])
  return baseSpeed * Math.abs((1 - handles.in[1]) / x)
}

function speedRange(tracks: GraphTrack[], contentWidth: number, pxPerSecond: number): ValueRange {
  let max = 0
  const step = 8
  for (const graph of tracks) {
    for (let x = 0; x <= contentWidth; x += step) {
      const speed = speedAtTrack(graph.track, xToTime(x, pxPerSecond))
      if (speed > max) max = speed
    }
  }
  return { min: 0, max: max < SPEED_EPSILON ? 1 : max * 1.15 }
}

function speedAtTrack(track: StageTrack, time: number): number {
  const keyframes = track.keyframes
  if (keyframes.length < 2) return 0
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (time < a.time || time > b.time) continue
    const u = (time - a.time) / Math.max(SPEED_EPSILON, b.time - a.time)
    return speedAtSegment(a, b, clamp01(u))
  }
  return 0
}

function segmentPolyline(a: StageKeyframe, b: StageKeyframe, range: ValueRange, height: number, pxPerSecond: number): string {
  const points: string[] = []
  const spanPx = Math.max(12, timeToX(b.time - a.time, pxPerSecond))
  const steps = Math.max(8, Math.min(72, Math.round(spanPx / 8)))
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps
    const time = a.time + (b.time - a.time) * u
    const speed = speedAtSegment(a, b, u)
    points.push(`${timeToX(time, pxPerSecond).toFixed(1)},${valueToY(speed, range, height).toFixed(1)}`)
  }
  return points.join(' ')
}

function buildSpeedEasing(
  current: StageEasing,
  endpoint: 'out' | 'in',
  influenceX: number,
  speed: number,
  baseSpeed: number,
): StageEasing {
  const handles = easingToHandles(current)
  const ratio = baseSpeed <= SPEED_EPSILON ? 0 : Math.max(0, speed) / baseSpeed
  if (endpoint === 'out') {
    const x = Math.max(HANDLE_MIN_INFLUENCE, Math.min(HANDLE_MAX_INFLUENCE, influenceX))
    return { type: 'bezier', out: [x, ratio * x], in: [...handles.in] }
  }
  const x = Math.max(HANDLE_MIN_INFLUENCE, Math.min(HANDLE_MAX_INFLUENCE, influenceX))
  return { type: 'bezier', out: [...handles.out], in: [x, 1 - ratio * (1 - x)] }
}

function isEased(easing: StageEasing): boolean {
  return easing !== 'linear'
}

const GraphEditor: React.FC<GraphEditorProps> = ({
  tracks,
  pxPerSecond,
  contentWidth,
  height,
  duration,
  fps,
  selectedKeys,
  onOpenEasing,
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<SpeedDragContext | null>(null)
  const moveKeyframe = useCameraStageStore((state) => state.moveKeyframe)
  const setKeyframesEasing = useCameraStageStore((state) => state.setKeyframesEasing)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)

  const range = speedRange(tracks, contentWidth, pxPerSecond)
  const latestRef = useRef({ pxPerSecond, duration, fps, range, height })
  latestRef.current = { pxPerSecond, duration, fps, range, height }

  const localPoint = (event: PointerPoint): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const buildEndpointEasing = (ctx: SpeedDragContext, speed: number, influenceX: number): StageEasing => {
    const span = Math.max(SPEED_EPSILON, ctx.t1 - ctx.t0)
    const baseSpeed = Math.abs((ctx.v1 - ctx.v0) / span)
    return buildSpeedEasing(ctx.easing, ctx.endpoint, influenceX, speed, baseSpeed)
  }

  const currentEndpointSpeed = (ctx: SpeedDragContext): number => {
    const span = Math.max(SPEED_EPSILON, ctx.t1 - ctx.t0)
    const baseSpeed = Math.abs((ctx.v1 - ctx.v0) / span)
    return endpointSpeed(ctx.easing, baseSpeed, ctx.endpoint)
  }

  const influenceFromPoint = (ctx: SpeedDragContext, point: { x: number }): number => {
    const latest = latestRef.current
    const span = Math.max(SPEED_EPSILON, ctx.t1 - ctx.t0)
    const time = xToTime(point.x, latest.pxPerSecond)
    return Math.max(HANDLE_MIN_INFLUENCE, Math.min(HANDLE_MAX_INFLUENCE, (time - ctx.t0) / span))
  }

  const applyHandleEdit = (ctx: SpeedDragContext, point: { x: number }): void => {
    const speed = currentEndpointSpeed(ctx)
    const next = buildEndpointEasing(ctx, speed, influenceFromPoint(ctx, point))
    ctx.easing = next
    setKeyframesEasing(
      [{ objectId: ctx.objectId, path: ctx.path, time: ctx.segmentStartTime }],
      next,
    )
  }

  const applyKeyframeSpeedEdit = (ctx: SpeedDragContext, point: { x: number; y: number }): void => {
    const speed = Math.max(0, yToValue(point.y, ctx.valueRange, ctx.graphHeight))
    const handles = easingToHandles(ctx.easing)
    const influenceX = ctx.endpoint === 'out' ? handles.out[0] : handles.in[0]
    const next = buildEndpointEasing(ctx, speed, influenceX)
    ctx.easing = next
    setKeyframesEasing(
      [{ objectId: ctx.objectId, path: ctx.path, time: ctx.segmentStartTime }],
      next,
    )
  }

  const handleDragMove = (event: PointerPoint): void => {
    const ctx = dragRef.current
    const point = localPoint(event)
    if (!ctx || !point) return
    if (ctx.kind === 'keyframe' && ctx.movingKeyTime !== undefined) {
      const latest = latestRef.current
      const next = snap(xToTime(point.x, latest.pxPerSecond), latest.duration, latest.fps, event.altKey)
      if (Math.abs(next - ctx.movingKeyTime) >= 1e-4) {
        moveKeyframe(ctx.objectId, ctx.path, ctx.movingKeyTime, next)
        if (Math.abs(ctx.segmentStartTime - ctx.movingKeyTime) < 1e-4) {
          ctx.segmentStartTime = next
          ctx.t0 = next
        } else {
          ctx.t1 = next
        }
        ctx.movingKeyTime = next
      }
      applyKeyframeSpeedEdit(ctx, point)
      return
    }
    applyHandleEdit(ctx, point)
  }

  const endDrag = (): void => {
    const ctx = dragRef.current
    if (!ctx) return
    dragRef.current = null
    endHistorySession()
    if (ctx.movingKeyTime !== undefined) {
      setSelectedKeyframes([keyframeKey(ctx.objectId, ctx.path, ctx.movingKeyTime)])
    }
  }

  const startDrag = (
    event: React.PointerEvent<SVGElement>,
    ctx: SpeedDragContext,
  ): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    beginHistorySession()
    dragRef.current = { ...ctx, pointerId: event.pointerId }
    if (ctx.movingKeyTime !== undefined) {
      setSelectedKeyframes([keyframeKey(ctx.objectId, ctx.path, ctx.movingKeyTime)])
    }
  }

  useEffect(() => {
    let frame = 0
    let pending: PointerPoint | null = null
    const flush = (): void => {
      frame = 0
      const point = pending
      pending = null
      if (point) handleDragMove(point)
    }
    const onMove = (event: PointerEvent): void => {
      const ctx = dragRef.current
      if (!ctx || event.pointerId !== ctx.pointerId) return
      event.preventDefault()
      pending = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey }
      if (!frame) frame = window.requestAnimationFrame(flush)
    }
    const onUp = (event: PointerEvent): void => {
      const ctx = dragRef.current
      if (!ctx || event.pointerId !== ctx.pointerId) return
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (pending) handleDragMove(pending)
      pending = null
      endDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', endDrag)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', endDrag)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openEasing = (
    event: React.MouseEvent<SVGElement>,
    graph: GraphTrack,
    time: number,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const key = keyframeKey(graph.objectId, graph.path, time)
    if (!selectedKeys.has(key)) setSelectedKeyframes([key])
    onOpenEasing({ objectId: graph.objectId, path: graph.path, time }, { x: event.clientX, y: event.clientY })
  }

  return (
    <svg
      ref={svgRef}
      width={contentWidth}
      height={height}
      className="touch-none select-none"
      style={{ background: CAMERA_STAGE_TIMELINE_HEX.laneActive }}
    >
      {valueGridTicks(range).map((value) => {
        const y = valueToY(value, range, height)
        return (
          <g key={value}>
            <line x1={0} y1={y} x2={contentWidth} y2={y} stroke={CAMERA_STAGE_TIMELINE_HEX.curveGrid} />
            <text x={4} y={y - 2} fontSize={9} fill={CAMERA_STAGE_TIMELINE_HEX.keyframe} opacity={0.65}>
              {value.toFixed(1)} /s
            </text>
          </g>
        )
      })}

      {tracks.map((graph) => (
        <g key={graph.path}>
          {graph.track.keyframes.slice(0, -1).map((kf, index) => {
            const next = graph.track.keyframes[index + 1]
            const color = axisColor(graph.path)
            return (
              <polyline
                key={`${graph.path}-${kf.time}-${next.time}`}
                points={segmentPolyline(kf, next, range, height, pxPerSecond)}
                fill="none"
                stroke={color}
                strokeWidth={1.7}
                opacity={0.95}
              />
            )
          })}
          {renderSpeedControls({
            graph,
            selectedKeys,
            pxPerSecond,
            range,
            height,
            onDragStart: startDrag,
            onOpenEasing: openEasing,
          })}
        </g>
      ))}
    </svg>
  )
}

function renderSpeedControls(options: {
  graph: GraphTrack
  selectedKeys: ReadonlySet<string>
  pxPerSecond: number
  range: ValueRange
  height: number
  onDragStart: (event: React.PointerEvent<SVGElement>, ctx: SpeedDragContext) => void
  onOpenEasing: (event: React.MouseEvent<SVGElement>, graph: GraphTrack, time: number) => void
}): React.ReactNode {
  const { graph, selectedKeys, pxPerSecond, range, height, onDragStart, onOpenEasing } = options
  const nodes: React.ReactNode[] = []
  const keyframes = graph.track.keyframes
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    const handles = easingToHandles(a.easing)
    const baseSpeed = segmentBaseSpeed(a, b)
    const startSpeed = endpointSpeed(a.easing, baseSpeed, 'out')
    const endSpeed = endpointSpeed(a.easing, baseSpeed, 'in')
    const startKey = keyframeKey(graph.objectId, graph.path, a.time)
    const endKey = keyframeKey(graph.objectId, graph.path, b.time)
    const startX = timeToX(a.time, pxPerSecond)
    const endX = timeToX(b.time, pxPerSecond)
    const startY = valueToY(startSpeed, range, height)
    const endY = valueToY(endSpeed, range, height)
    const outX = timeToX(a.time + handles.out[0] * (b.time - a.time), pxPerSecond)
    const inX = timeToX(a.time + handles.in[0] * (b.time - a.time), pxPerSecond)
    const color = CAMERA_STAGE_TIMELINE_HEX.curveHandle
    const showHandles = selectedKeys.has(startKey) || selectedKeys.has(endKey) || isEased(a.easing)
    const common = {
      objectId: graph.objectId,
      path: graph.path,
      segmentStartTime: a.time,
      t0: a.time,
      v0: a.value as number,
      t1: b.time,
      v1: b.value as number,
      easing: a.easing,
      valueRange: range,
      graphHeight: height,
    }
    nodes.push(
      <g key={`speed-${a.time}-${b.time}`}>
        {showHandles && (
          <>
            <line x1={startX} y1={startY} x2={outX} y2={startY} stroke={color} opacity={0.65} />
            <line x1={endX} y1={endY} x2={inX} y2={endY} stroke={color} opacity={0.65} />
            <circle
              data-graph-handle="true"
              cx={outX}
              cy={startY}
              r={4}
              className="cursor-ew-resize"
              fill={color}
              onPointerDown={(event) => onDragStart(event, { ...common, kind: 'handle', endpoint: 'out' })}
            />
            <circle
              data-graph-handle="true"
              cx={inX}
              cy={endY}
              r={4}
              className="cursor-ew-resize"
              fill={color}
              onPointerDown={(event) => onDragStart(event, { ...common, kind: 'handle', endpoint: 'in' })}
            />
          </>
        )}
        <SpeedMarker
          x={startX}
          y={startY}
          selected={selectedKeys.has(startKey)}
          eased={isEased(a.easing)}
          color={axisColor(graph.path)}
          dataKeys={startKey}
          onPointerDown={(event) => onDragStart(event, { ...common, kind: 'keyframe', endpoint: 'out', movingKeyTime: a.time })}
          onDoubleClick={(event) => onOpenEasing(event, graph, a.time)}
          onContextMenu={(event) => onOpenEasing(event, graph, a.time)}
        />
        <SpeedMarker
          x={endX}
          y={endY}
          selected={selectedKeys.has(endKey)}
          eased={isEased(a.easing)}
          color={axisColor(graph.path)}
          dataKeys={endKey}
          onPointerDown={(event) => onDragStart(event, { ...common, kind: 'keyframe', endpoint: 'in', movingKeyTime: b.time })}
          onDoubleClick={(event) => onOpenEasing(event, graph, b.time)}
          onContextMenu={(event) => onOpenEasing(event, graph, b.time)}
        />
      </g>,
    )
  }
  return nodes
}

const SpeedMarker: React.FC<{
  x: number
  y: number
  selected: boolean
  eased: boolean
  color: string
  dataKeys: string
  onPointerDown: (event: React.PointerEvent<SVGElement>) => void
  onDoubleClick: (event: React.MouseEvent<SVGElement>) => void
  onContextMenu: (event: React.MouseEvent<SVGElement>) => void
}> = ({ x, y, selected, eased, color, dataKeys, onPointerDown, onDoubleClick, onContextMenu }) => {
  const fill = selected ? CAMERA_STAGE_TIMELINE_HEX.keyframeSelected : color
  if (eased) {
    const w = selected ? 11 : 9
    const h = selected ? 15 : 13
    const points = `${x - w / 2},${y - h / 2} ${x + w / 2},${y - h / 2} ${x + 2},${y} ${x + w / 2},${y + h / 2} ${x - w / 2},${y + h / 2} ${x - 2},${y}`
    return (
      <polygon
        data-keyframe-keys={dataKeys}
        points={points}
        className="cursor-pointer"
        fill={fill}
        stroke={CAMERA_STAGE_TIMELINE_HEX.laneActive}
        strokeWidth={1}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    )
  }
  return (
    <rect
      data-keyframe-keys={dataKeys}
      x={x - 4}
      y={y - 4}
      width={8}
      height={8}
      transform={`rotate(45 ${x} ${y})`}
      className="cursor-pointer"
      fill={fill}
      stroke={CAMERA_STAGE_TIMELINE_HEX.laneActive}
      strokeWidth={1}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    />
  )
}

export default GraphEditor
