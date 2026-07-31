import { useCallback, useEffect, useRef, type RefObject, type WheelEvent } from 'react'

const STICKY_BOTTOM_THRESHOLD = 32
const REATTACH_BOTTOM_THRESHOLD = 4

interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function distanceFromScrollBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)
}

interface ConversationAutoScroll {
  viewportRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  onScroll: () => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
}

export function useConversationAutoScroll(resetKey: string | null): ConversationAutoScroll {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const frameRef = useRef<number | null>(null)

  const cancelScheduledScroll = useCallback((): void => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const scheduleScrollToBottom = useCallback((): void => {
    if (!stickToBottomRef.current || frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const viewport = viewportRef.current
      if (!viewport || !stickToBottomRef.current) return
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    })
  }, [])

  useEffect(() => {
    stickToBottomRef.current = true
    scheduleScrollToBottom()
  }, [resetKey, scheduleScrollToBottom])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(scheduleScrollToBottom)
    observer.observe(content)
    scheduleScrollToBottom()
    return () => {
      observer.disconnect()
      cancelScheduledScroll()
    }
  }, [cancelScheduledScroll, scheduleScrollToBottom])

  const onScroll = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = stickToBottomRef.current
      ? STICKY_BOTTOM_THRESHOLD
      : REATTACH_BOTTOM_THRESHOLD
    stickToBottomRef.current = distanceFromScrollBottom(viewport) <= threshold
  }, [])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0) stickToBottomRef.current = false
  }, [])

  return { viewportRef, contentRef, onScroll, onWheel }
}
