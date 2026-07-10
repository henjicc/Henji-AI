import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'
import type { StageShot } from '../../domain/shotTypes'
import { xToTime } from '../../timeline/timeScale'
import { quantizeToFrame } from './shotClipGeometry'

const logger = createLogger('features.cameraStage.simple')
const DRAG_THRESHOLD_PX = 3

export interface KeyframeTimeDragPreview {
  shotId: string
  time: number
  offsetX: number
}

interface DragRef {
  shotId: string
  pointerId: number
  startClientX: number
  startTime: number
  previewTime: number
  moved: boolean
}

interface UseKeyframeTimeDragOptions {
  shots: StageShot[]
  fps: number
  pxPerSecond: number
  onCommit: (shotId: string, time: number) => void
}

/** 拖动状态关键帧的绝对时间；预览与提交都按帧吸附，并禁止跨越相邻关键帧。 */
export function useKeyframeTimeDrag({
  shots,
  fps,
  pxPerSecond,
  onCommit,
}: UseKeyframeTimeDragOptions): {
  preview: KeyframeTimeDragPreview | null
  beginDrag: (event: React.PointerEvent, shotId: string) => void
  handlePointerMove: (event: React.PointerEvent) => void
  handlePointerUp: (event: React.PointerEvent) => void
  handlePointerCancel: (event: React.PointerEvent) => void
  /** 拖拽结束后浏览器仍会补发一次 click；消费本标记以阻止其触发选中/弹面板。 */
  consumeClickSuppression: () => boolean
} {
  const [preview, setPreview] = useState<KeyframeTimeDragPreview | null>(null)
  const dragRef = useRef<DragRef | null>(null)
  const suppressClickRef = useRef(false)

  const cancel = useCallback((): void => {
    if (dragRef.current?.moved) suppressClickRef.current = true
    dragRef.current = null
    setPreview(null)
  }, [])

  useEffect(() => {
    if (!preview) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview, cancel])

  const beginDrag = useCallback((event: React.PointerEvent, shotId: string): void => {
    const shot = shots.find((item) => item.id === shotId)
    if (!shot) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      shotId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startTime: shot.time,
      previewTime: shot.time,
      moved: false,
    }
  }, [shots])

  const handlePointerMove = useCallback((event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startClientX
    if (!drag.moved && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    const index = shots.findIndex((shot) => shot.id === drag.shotId)
    if (index < 0) return
    const frame = 1 / Math.max(1, fps)
    const minimum = index === 0 ? 0 : shots[index - 1].time + frame
    const maximum = index === shots.length - 1 ? Number.POSITIVE_INFINITY : shots[index + 1].time - frame
    const candidate = quantizeToFrame(drag.startTime + xToTime(deltaX, pxPerSecond), fps)
    const time = Math.min(maximum, Math.max(minimum, candidate))
    drag.previewTime = time
    setPreview({ shotId: drag.shotId, time, offsetX: (time - drag.startTime) * pxPerSecond })
  }, [fps, pxPerSecond, shots])

  const handlePointerUp = useCallback((event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (drag.moved && Math.abs(drag.previewTime - drag.startTime) > 1e-6) {
      onCommit(drag.shotId, drag.previewTime)
      logger.debug('拖动状态关键帧时间', {
        event: 'simple_mode.keyframe.dragged',
        shotId: drag.shotId,
        fromTime: drag.startTime,
        toTime: drag.previewTime,
      })
    }
    cancel()
  }, [cancel, onCommit])

  const handlePointerCancel = useCallback((event: React.PointerEvent): void => {
    if (dragRef.current?.pointerId === event.pointerId) cancel()
  }, [cancel])

  const consumeClickSuppression = useCallback((): boolean => {
    const suppressed = suppressClickRef.current
    suppressClickRef.current = false
    return suppressed
  }, [])

  return { preview, beginDrag, handlePointerMove, handlePointerUp, handlePointerCancel, consumeClickSuppression }
}
