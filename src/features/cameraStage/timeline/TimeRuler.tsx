import React, { useCallback, useRef } from 'react'
import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'
import { generateTicks, xToTime, type TimeRulerMode } from './timeScale'
import { TIMELINE_RULER_HEIGHT } from './timelineLayout'

/** 时间刻度尺：绘制主/次刻度与标签，pointer 拖拽 scrub 播放头 */

interface TimeRulerProps {
  duration: number
  pxPerSecond: number
  contentWidth: number
  mode: TimeRulerMode
  fps: number
  onScrub: (time: number) => void
}

const TimeRuler: React.FC<TimeRulerProps> = ({
  duration,
  pxPerSecond,
  contentWidth,
  mode,
  fps,
  onScrub,
}) => {
  const rulerRef = useRef<HTMLDivElement>(null)
  const ticks = generateTicks(duration, pxPerSecond, mode, fps)

  const scrubTo = useCallback(
    (clientX: number): void => {
      const rect = rulerRef.current?.getBoundingClientRect()
      if (!rect) return
      onScrub(xToTime(clientX - rect.left, pxPerSecond))
    },
    [onScrub, pxPerSecond],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubTo(event.clientX)
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.buttons !== 1) return
    scrubTo(event.clientX)
  }

  return (
    <div
      ref={rulerRef}
      data-timeline-ruler="true"
      className="relative cursor-ew-resize select-none bg-surface-dark"
      style={{ width: contentWidth, height: TIMELINE_RULER_HEIGHT }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      {ticks.map((tick) => (
        <div
          key={tick.time}
          className="absolute bottom-0"
          style={{
            left: tick.x,
            height: tick.major ? '100%' : '40%',
            borderLeft: `1px solid ${CAMERA_STAGE_TIMELINE_HEX.laneBorder}`,
          }}
        >
          {tick.label && (
            <span className="absolute left-1 top-0 whitespace-nowrap text-[10px] leading-none text-text-muted">
              {tick.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default TimeRuler
