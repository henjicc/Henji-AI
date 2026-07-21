import React, { useRef } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { KEYFRAME_TIME_EPSILON, type StageEasing, type StageTrack } from '../domain/animationTypes'
import {
  beginHistorySession,
  endHistorySession,
  keyframeKey,
  useCameraStageStore,
} from '../store/cameraStageStore'
import { timeToX, xToTime } from './timeScale'
import { TIMELINE_ROW_HEIGHT, type EasingEditTarget } from './timelineLayout'

/**
 * 分组父行合并泳道（vec3 属性用）：把 X/Y/Z 各分量在同一时间的关键帧合并成一个菱形，
 * 拖动 = 同时移动该时间所有分量关键帧；选中 = 选中该时间全部分量关键帧（供批量缓动/删除）。
 */

interface GroupLaneProps {
  objectId: string
  childTracks: StageTrack[]
  pxPerSecond: number
  contentWidth: number
  duration: number
  fps: number
  selectedKeys: ReadonlySet<string>
  onOpenEasing: (target: EasingEditTarget, anchor: { x: number; y: number }) => void
}

/** 收集所有分量轨道去重后的关键帧时间（升序） */
function mergedTimes(tracks: StageTrack[]): number[] {
  const set = new Set<number>()
  for (const track of tracks) {
    for (const kf of track.keyframes) set.add(kf.time)
  }
  return [...set].sort((a, b) => a - b)
}

function childKeysAtTime(objectId: string, tracks: StageTrack[], time: number): string[] {
  const keys: string[] = []
  for (const track of tracks) {
    if (track.keyframes.some((kf) => Math.abs(kf.time - time) <= KEYFRAME_TIME_EPSILON)) {
      keys.push(keyframeKey(objectId, track.propertyPath, time))
    }
  }
  return keys
}

function isEased(easing: StageEasing): boolean {
  return easing !== 'linear'
}

function hasEasedKeyframeAtTime(tracks: StageTrack[], time: number): boolean {
  return tracks.some((track) =>
    track.keyframes.some((kf) => Math.abs(kf.time - time) <= KEYFRAME_TIME_EPSILON && isEased(kf.easing)),
  )
}

const GroupLane: React.FC<GroupLaneProps> = ({
  objectId,
  childTracks,
  pxPerSecond,
  contentWidth,
  duration,
  fps,
  selectedKeys,
  onOpenEasing,
}) => {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ time: number; moved: boolean } | null>(null)
  const moveKeyframe = useCameraStageStore((state) => state.moveKeyframe)
  const setSelectedKeyframes = useCameraStageStore((state) => state.setSelectedKeyframes)

  const times = mergedTimes(childTracks)

  const snap = (time: number, alt: boolean): number => {
    const clamped = Math.max(0, Math.min(duration, time))
    return alt || fps <= 0 ? clamped : Math.round(clamped * fps) / fps
  }

  const handleDown = (event: React.PointerEvent<HTMLDivElement>, time: number): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedKeyframes(childKeysAtTime(objectId, childTracks, time))
    beginHistorySession()
    dragRef.current = { time, moved: false }
  }

  const handleMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const rect = laneRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    const next = snap(xToTime(event.clientX - rect.left, pxPerSecond), event.altKey)
    if (Math.abs(next - drag.time) < 1e-4) return
    for (const track of childTracks) {
      if (track.keyframes.some((kf) => Math.abs(kf.time - drag.time) <= KEYFRAME_TIME_EPSILON)) {
        moveKeyframe(objectId, track.propertyPath, drag.time, next)
      }
    }
    drag.time = next
    drag.moved = true
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    endHistorySession()
    setSelectedKeyframes(childKeysAtTime(objectId, childTracks, drag.time))
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const openEasing = (event: React.MouseEvent, time: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const keys = childKeysAtTime(objectId, childTracks, time)
    if (!keys.every((key) => selectedKeys.has(key))) setSelectedKeyframes(keys)
    onOpenEasing({ objectId, path: childTracks[0]?.propertyPath ?? '', time }, {
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
      {times.map((time) => {
        const keys = childKeysAtTime(objectId, childTracks, time)
        const selected = keys.length > 0 && keys.every((key) => selectedKeys.has(key))
        const eased = hasEasedKeyframeAtTime(childTracks, time)
        return (
          <div
            key={time}
            role="button"
            tabIndex={-1}
            data-keyframe-keys={keys.join(',')}
            aria-label={`分组关键帧 ${time.toFixed(2)}s`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[1px] ${
              eased ? 'h-3.5 w-2.5' : 'h-2.5 w-2.5 rotate-45'
            }`}
            style={{
              left: timeToX(time, pxPerSecond),
              backgroundColor: selected
                ? CAMERA_STAGE_TIMELINE_HEX.keyframeSelected
                : eased
                ? CAMERA_STAGE_TIMELINE_HEX.keyframeEased
                : CAMERA_STAGE_TIMELINE_HEX.keyframe,
              clipPath: eased
                ? 'polygon(0 0, 100% 0, 62% 50%, 100% 100%, 0 100%, 38% 50%)'
                : undefined,
            }}
            onPointerDown={(event) => handleDown(event, time)}
            onPointerMove={handleMove}
            onPointerUp={endDrag}
            onDoubleClick={(event) => openEasing(event, time)}
            onContextMenu={(event) => openEasing(event, time)}
          />
        )
      })}
    </div>
  )
}

export default GroupLane
