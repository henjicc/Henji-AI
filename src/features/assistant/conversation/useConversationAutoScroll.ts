import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type WheelEvent,
} from 'react'

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
  isFollowing: boolean
  hasNewContent: boolean
  onScroll: () => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  scrollToBottom: () => void
}

const DETACH_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

export function useConversationAutoScroll(resetKey: string | null): ConversationAutoScroll {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const frameRef = useRef<number | null>(null)
  const [isFollowing, setIsFollowing] = useState(true)
  const [hasNewContent, setHasNewContent] = useState(false)

  const updateFollowing = useCallback((following: boolean): void => {
    stickToBottomRef.current = following
    setIsFollowing((current) => current === following ? current : following)
    if (following) setHasNewContent(false)
  }, [])

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

  const handleObservedResize = useCallback((entries: ResizeObserverEntry[]): void => {
    if (stickToBottomRef.current) {
      scheduleScrollToBottom()
      return
    }
    if (entries.some((entry) => entry.target === contentRef.current)) setHasNewContent(true)
  }, [scheduleScrollToBottom])

  const scrollToBottom = useCallback((): void => {
    updateFollowing(true)
    cancelScheduledScroll()
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  }, [cancelScheduledScroll, updateFollowing])

  useEffect(() => {
    updateFollowing(true)
    scheduleScrollToBottom()
  }, [resetKey, scheduleScrollToBottom, updateFollowing])

  useEffect(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return
    const observer = new ResizeObserver(handleObservedResize)
    observer.observe(content)
    observer.observe(viewport)
    scheduleScrollToBottom()
    return () => {
      observer.disconnect()
      cancelScheduledScroll()
    }
  }, [cancelScheduledScroll, handleObservedResize, scheduleScrollToBottom])

  const onScroll = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = stickToBottomRef.current
      ? STICKY_BOTTOM_THRESHOLD
      : REATTACH_BOTTOM_THRESHOLD
    updateFollowing(distanceFromScrollBottom(viewport) <= threshold)
  }, [updateFollowing])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0) updateFollowing(false)
  }, [updateFollowing])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (DETACH_KEYS.has(event.key)) updateFollowing(false)
  }, [updateFollowing])

  return {
    viewportRef,
    contentRef,
    isFollowing,
    hasNewContent,
    onScroll,
    onWheel,
    onKeyDown,
    scrollToBottom,
  }
}
