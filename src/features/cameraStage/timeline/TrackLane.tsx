import React, { useRef } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import type { StageEasing, StageTrack } from '../domain/animationTypes'
import {
  beginHistorySession,
  endHistorySession,
  keyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import { timeToX, xToTime } from './timeScale'
import { TIMELINE_ROW_HEIGHT, type EasingEditTarget } from './timelineLayout'

/** 单条轨道的关键帧泳道：菱形点位 + 水平拖移改时间 + 单选/加选 + 双击/右键进缓动编辑 */

interface TrackLaneProps {
  track: StageTrack
  pxPerSecond: number
  contentWidth: number
  duration: number
  fps: number
  selectedKeys: ReadonlySet<string>
  onOpenEasing: (target: EasingEditTarget, anchor: { x: number; y: number }) => void
}

/** 非线性缓动（非 linear 预设）在菱形上用不同颜色提示 */
function isEased(easing: StageEasing): boolean {
  return easing !== 'linear'
}

const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  pxPerSecond,
  contentWidth,
  duration,
  fps,
  selectedKeys,
  onOpenEasing,
}) => {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; time: number; moved: boolean } | null>(null)
  const moveKeyframe = useCameraStageStore((state) => state.moveKeyframe)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)

  const snapToFrame = (time: number, alt: boolean): number => {
    const clamped = Math.max(0, Math.min(duration, time))
    if (alt || fps <= 0) return clamped
    return Math.round(clamped * fps) / fps
  }

  const selectKeyframe = (time: number, additive: boolean): void => {
    const key = keyframeKey(track.objectId, track.propertyPath, time)
    if (additive) {
      const next = new Set(selectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setSelectedKeyframes([...next])
    } else {
      setSelectedKeyframes([key])
    }
  }

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    time: number,
  ): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    selectKeyframe(time, event.shiftKey)
    beginHistorySession()
    dragRef.current = { pointerId: event.pointerId, time, moved: false }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const rect = laneRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    const next = snapToFrame(xToTime(event.clientX - rect.left, pxPerSecond), event.altKey)
    if (Math.abs(next - drag.time) < 1e-4) return
    moveKeyframe(track.objectId, track.propertyPath, drag.time, next)
    drag.time = next
    drag.moved = true
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    endHistorySession()
    if (drag.moved) {
      setSelectedKeyframes([keyframeKey(track.objectId, track.propertyPath, drag.time)])
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleContext = (
    event: React.MouseEvent<HTMLDivElement>,
    time: number,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const key = keyframeKey(track.objectId, track.propertyPath, time)
    if (!selectedKeys.has(key)) setSelectedKeyframes([key])
    onOpenEasing({ objectId: track.objectId, path: track.propertyPath, time }, {
      x: event.clientX,
      y: event.clientY,
    })
  }

  return (
    <div
      ref={laneRef}
      className="relative"
      style={{
        width: contentWidth,
        height: TIMELINE_ROW_HEIGHT,
        borderBottom: `1px solid ${CAMERA_STAGE_TIMELINE_HEX.laneBorder}`,
      }}
    >
      {track.keyframes.map((keyframe) => {
        const key = keyframeKey(track.objectId, track.propertyPath, keyframe.time)
        const selected = selectedKeys.has(key)
        const color = selected
          ? CAMERA_STAGE_TIMELINE_HEX.keyframeSelected
          : isEased(keyframe.easing)
          ? CAMERA_STAGE_TIMELINE_HEX.keyframeEased
          : CAMERA_STAGE_TIMELINE_HEX.keyframe
        return (
          <div
            key={key}
            role="button"
            tabIndex={-1}
            data-keyframe-keys={key}
            aria-label={`关键帧 ${keyframe.time.toFixed(2)}s`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[1px] ${
              isEased(keyframe.easing) ? 'h-3.5 w-2.5' : 'h-2.5 w-2.5 rotate-45'
            }`}
            style={{
              left: timeToX(keyframe.time, pxPerSecond),
              backgroundColor: color,
              clipPath: isEased(keyframe.easing)
                ? 'polygon(0 0, 100% 0, 62% 50%, 100% 100%, 0 100%, 38% 50%)'
                : undefined,
            }}
            onPointerDown={(event) => handlePointerDown(event, keyframe.time)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onDoubleClick={(event) =>
              onOpenEasing(
                { objectId: track.objectId, path: track.propertyPath, time: keyframe.time },
                { x: event.clientX, y: event.clientY },
              )
            }
            onContextMenu={(event) => handleContext(event, keyframe.time)}
          />
        )
      })}
    </div>
  )
}

export default TrackLane
