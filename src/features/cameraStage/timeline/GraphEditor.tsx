import React, { useRef } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { resolveEasingControlPoints, sampleTrack } from '../domain/keyframeEngine'
import type { StageEasing, StageTrack } from '../domain/animationTypes'
import {
  beginHistorySession,
  endHistorySession,
  keyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import { timeToX, xToTime } from './timeScale'
import { axisColor } from './graphColors'
import {
  computeValueRange,
  valueGridTicks,
  valueToY,
  yToValue,
  type ValueRange,
} from './graphGeometry'

/**
 * 值曲线图表编辑器（AE 图表编辑器的值曲线视图）：把选中对象的 scalar 轨道画成值随时间的曲线，
 * 支持拖点改「时间+值」、拖贝塞尔手柄改缓动。求值仍复用 3.1 keyframeEngine，不改内核。
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
}

/** 采样一条轨道在可见时间范围内的曲线折线点 */
function sampleCurve(track: StageTrack, pxPerSecond: number, contentWidth: number, range: ValueRange, height: number): string {
  const points: string[] = []
  const step = 4
  for (let x = 0; x <= contentWidth; x += step) {
    const value = sampleTrack(track, xToTime(x, pxPerSecond), 'scalar')
    if (typeof value !== 'number') continue
    points.push(`${x},${valueToY(value, range, height).toFixed(1)}`)
  }
  return points.join(' ')
}

const GraphEditor: React.FC<GraphEditorProps> = ({
  tracks,
  pxPerSecond,
  contentWidth,
  height,
  duration,
  fps,
  selectedKeys,
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ objectId: string; path: string; time: number } | null>(null)
  const handleRef = useRef<{ objectId: string; path: string; time: number; which: 'out' | 'in'; t0: number; v0: number; t1: number; v1: number } | null>(null)

  const moveKeyframe = useCameraStageStore((state) => state.moveKeyframe)
  const setKeyframeValue = useCameraStageStore((state) => state.setKeyframeValue)
  const setKeyframesEasing = useCameraStageStore((state) => state.setKeyframesEasing)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)

  const allValues = tracks.flatMap((item) => item.track.keyframes.map((kf) => kf.value as number))
  const range = computeValueRange(allValues)

  const localPoint = (event: React.PointerEvent): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const snap = (time: number, alt: boolean): number => {
    const clamped = Math.max(0, Math.min(duration, time))
    return alt || fps <= 0 ? clamped : Math.round(clamped * fps) / fps
  }

  /* ---- 关键帧点：拖「时间 + 值」 ---- */
  const onPointDown = (event: React.PointerEvent<SVGCircleElement>, graph: GraphTrack, time: number): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedKeyframes([keyframeKey(graph.objectId, graph.path, time)])
    beginHistorySession()
    dragRef.current = { objectId: graph.objectId, path: graph.path, time }
  }
  const onPointMove = (event: React.PointerEvent<SVGCircleElement>): void => {
    const drag = dragRef.current
    const point = localPoint(event)
    if (!drag || !point) return
    const nextTime = snap(xToTime(point.x, pxPerSecond), event.altKey)
    if (Math.abs(nextTime - drag.time) >= 1e-4) {
      moveKeyframe(drag.objectId, drag.path, drag.time, nextTime)
      drag.time = nextTime
    }
    setKeyframeValue(drag.objectId, drag.path, drag.time, yToValue(point.y, range, height))
  }
  const onPointUp = (event: React.PointerEvent<SVGCircleElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    endHistorySession()
    setSelectedKeyframes([keyframeKey(drag.objectId, drag.path, drag.time)])
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  /* ---- 缓动手柄：拖出/入手柄改本段缓动 ---- */
  const onHandleDown = (
    event: React.PointerEvent<SVGCircleElement>,
    ctx: NonNullable<typeof handleRef.current>,
  ): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    beginHistorySession()
    handleRef.current = ctx
  }
  const onHandleMove = (event: React.PointerEvent<SVGCircleElement>): void => {
    const ctx = handleRef.current
    const point = localPoint(event)
    if (!ctx || !point) return
    const spanT = ctx.t1 - ctx.t0
    const spanV = ctx.v1 - ctx.v0
    const nx = spanT <= 1e-6 ? 0 : Math.max(0, Math.min(1, (xToTime(point.x, pxPerSecond) - ctx.t0) / spanT))
    const ny = Math.abs(spanV) <= 1e-6 ? 0 : (yToValue(point.y, range, height) - ctx.v0) / spanV
    const current = findEasing(tracks, ctx.objectId, ctx.path, ctx.time)
    const [x1, y1, x2, y2] = resolveEasingControlPoints(current)
    const next: StageEasing =
      ctx.which === 'out'
        ? { type: 'bezier', out: [nx, ny], in: [x2, y2] }
        : { type: 'bezier', out: [x1, y1], in: [nx, ny] }
    setKeyframesEasing([{ objectId: ctx.objectId, path: ctx.path, time: ctx.time }], next)
  }
  const onHandleUp = (event: React.PointerEvent<SVGCircleElement>): void => {
    if (!handleRef.current) return
    handleRef.current = null
    endHistorySession()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
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
            <text x={4} y={y - 2} fontSize={9} fill={CAMERA_STAGE_TIMELINE_HEX.keyframe} opacity={0.6}>
              {value.toFixed(2)}
            </text>
          </g>
        )
      })}

      {tracks.map((graph) => {
        const color = axisColor(graph.path)
        return (
          <g key={graph.path}>
            <polyline
              points={sampleCurve(graph.track, pxPerSecond, contentWidth, range, height)}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              opacity={0.9}
            />
            {renderHandles(graph, selectedKeys, pxPerSecond, range, height, onHandleDown, onHandleMove, onHandleUp)}
            {graph.track.keyframes.map((kf) => {
              const key = keyframeKey(graph.objectId, graph.path, kf.time)
              const selected = selectedKeys.has(key)
              return (
                <circle
                  key={key}
                  cx={timeToX(kf.time, pxPerSecond)}
                  cy={valueToY(kf.value as number, range, height)}
                  r={selected ? 5 : 4}
                  className="cursor-pointer"
                  fill={selected ? CAMERA_STAGE_TIMELINE_HEX.keyframeSelected : color}
                  stroke={CAMERA_STAGE_TIMELINE_HEX.laneActive}
                  strokeWidth={1}
                  onPointerDown={(event) => onPointDown(event, graph, kf.time)}
                  onPointerMove={onPointMove}
                  onPointerUp={onPointUp}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

function findEasing(tracks: GraphTrack[], objectId: string, path: string, time: number): StageEasing {
  const graph = tracks.find((item) => item.objectId === objectId && item.path === path)
  const kf = graph?.track.keyframes.find((item) => Math.abs(item.time - time) <= 1e-4)
  return kf?.easing ?? 'linear'
}

/** 为选中关键帧的出向区间渲染 out/in 两个缓动手柄 */
function renderHandles(
  graph: GraphTrack,
  selectedKeys: ReadonlySet<string>,
  pxPerSecond: number,
  range: ValueRange,
  height: number,
  onDown: (event: React.PointerEvent<SVGCircleElement>, ctx: { objectId: string; path: string; time: number; which: 'out' | 'in'; t0: number; v0: number; t1: number; v1: number }) => void,
  onMove: (event: React.PointerEvent<SVGCircleElement>) => void,
  onUp: (event: React.PointerEvent<SVGCircleElement>) => void,
): React.ReactNode {
  const keyframes = graph.track.keyframes
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (!selectedKeys.has(keyframeKey(graph.objectId, graph.path, a.time))) continue
    const [x1, y1, x2, y2] = resolveEasingControlPoints(a.easing)
    const t0 = a.time
    const v0 = a.value as number
    const t1 = b.time
    const v1 = b.value as number
    const ax = timeToX(t0, pxPerSecond)
    const ay = valueToY(v0, range, height)
    const bx = timeToX(t1, pxPerSecond)
    const by = valueToY(v1, range, height)
    const outX = timeToX(t0 + x1 * (t1 - t0), pxPerSecond)
    const outY = valueToY(v0 + y1 * (v1 - v0), range, height)
    const inX = timeToX(t0 + x2 * (t1 - t0), pxPerSecond)
    const inY = valueToY(v0 + y2 * (v1 - v0), range, height)
    const handleColor = CAMERA_STAGE_TIMELINE_HEX.curveHandle
    nodes.push(
      <g key={`h-${a.time}`}>
        <line x1={ax} y1={ay} x2={outX} y2={outY} stroke={handleColor} opacity={0.6} />
        <line x1={bx} y1={by} x2={inX} y2={inY} stroke={handleColor} opacity={0.6} />
        <circle
          cx={outX}
          cy={outY}
          r={4}
          className="cursor-grab"
          fill={handleColor}
          onPointerDown={(event) => onDown(event, { objectId: graph.objectId, path: graph.path, time: t0, which: 'out', t0, v0, t1, v1 })}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
        <circle
          cx={inX}
          cy={inY}
          r={4}
          className="cursor-grab"
          fill={handleColor}
          onPointerDown={(event) => onDown(event, { objectId: graph.objectId, path: graph.path, time: t0, which: 'in', t0, v0, t1, v1 })}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      </g>,
    )
  }
  return nodes
}

export default GraphEditor
