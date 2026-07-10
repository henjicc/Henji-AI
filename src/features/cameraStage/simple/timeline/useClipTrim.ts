import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'
import { xToTime } from '../../timeline/timeScale'
import type { ShotTimingPatch } from '../../store/shotSlice'
import { clampHold, clampTransition, quantizeToFrame, type ShotClipBlockKind } from './shotClipGeometry'

const logger = createLogger('features.cameraStage.simple')

export interface ClipTrimTarget {
  shotId: string
  kind: ShotClipBlockKind
  /** 拖拽开始时的当前值（秒，未量化的 store 原始值） */
  currentValue: number
}

/** 拖拽中的实时预览值，供 ShotClipTrack 合并进本地布局与浮签展示 */
export interface ClipTrimPreview {
  shotId: string
  kind: ShotClipBlockKind
  /** 量化钳制后的秒值 */
  value: number
}

interface ClipTrimDragRef {
  shotId: string
  kind: ShotClipBlockKind
  pointerId: number
  startClientX: number
  startValue: number
  previewValue: number
}

interface UseClipTrimOptions {
  fps: number
  pxPerSecond: number
  onCommit: (shotId: string, patch: ShotTimingPatch) => void
}

function clampByKind(kind: ShotClipBlockKind, value: number, fps: number): number {
  return kind === 'static' ? clampHold(value, fps) : clampTransition(value, fps)
}

function buildPatch(kind: ShotClipBlockKind, value: number): ShotTimingPatch {
  return kind === 'static' ? { hold: value } : { transitionDuration: value }
}

/**
 * 块右边缘 trim 拖拽 hook（PR 式）：pointerdown 记录起点 → pointermove 换算增量并按帧吸附/钳制，
 * 只更新本地预览状态（不写 store）→ pointerup 一次性提交 `onCommit`。Escape 取消恢复原值。
 * 纯 hook，不直接依赖 store，提交完全走回调，便于 ShotClipTrack/ShotTimelinePanel 接线。
 */
export function useClipTrim({ fps, pxPerSecond, onCommit }: UseClipTrimOptions): {
  preview: ClipTrimPreview | null
  isTrimming: boolean
  beginTrim: (event: React.PointerEvent, target: ClipTrimTarget) => void
  handlePointerMove: (event: React.PointerEvent) => void
  handlePointerUp: (event: React.PointerEvent) => void
  handlePointerCancel: (event: React.PointerEvent) => void
} {
  const [preview, setPreview] = useState<ClipTrimPreview | null>(null)
  const dragRef = useRef<ClipTrimDragRef | null>(null)

  const cancelDrag = useCallback((): void => {
    dragRef.current = null
    setPreview(null)
  }, [])

  useEffect(() => {
    if (!preview) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [preview, cancelDrag])

  const beginTrim = useCallback((event: React.PointerEvent, target: ClipTrimTarget): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startValue = quantizeToFrame(clampByKind(target.kind, target.currentValue, fps), fps)
    dragRef.current = {
      shotId: target.shotId,
      kind: target.kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startValue,
      previewValue: startValue,
    }
    setPreview({ shotId: target.shotId, kind: target.kind, value: startValue })
  }, [fps])

  const handlePointerMove = useCallback((event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const deltaTime = xToTime(event.clientX - drag.startClientX, pxPerSecond)
    const nextValue = quantizeToFrame(clampByKind(drag.kind, drag.startValue + deltaTime, fps), fps)
    if (nextValue === drag.previewValue) return
    dragRef.current = { ...drag, previewValue: nextValue }
    setPreview({ shotId: drag.shotId, kind: drag.kind, value: nextValue })
  }, [fps, pxPerSecond])

  const handlePointerUp = useCallback((event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (drag.previewValue !== drag.startValue) {
      onCommit(drag.shotId, buildPatch(drag.kind, drag.previewValue))
      logger.debug('trim 拖拽提交时长变更', {
        event: 'simple_mode.shot_timing.trimmed',
        shotId: drag.shotId,
        kind: drag.kind,
        fromValue: drag.startValue,
        toValue: drag.previewValue,
      })
    }
    dragRef.current = null
    setPreview(null)
  }, [onCommit])

  const handlePointerCancel = useCallback((event: React.PointerEvent): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    cancelDrag()
  }, [cancelDrag])

  return {
    preview,
    isTrimming: preview !== null,
    beginTrim,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  }
}
