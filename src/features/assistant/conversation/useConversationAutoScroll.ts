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
  /** 用户主动展开/收起某一段时调用：保持点击位置不动，不要把视口拽到底部。 */
  suspendFollowing: () => void
}

const DETACH_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

export function useConversationAutoScroll(resetKey: string | null): ConversationAutoScroll {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const frameRef = useRef<number | null>(null)
  /**
   * 我们自己刚刚滚到的位置。
   *
   * 程序化滚动会异步触发一次 scroll 事件，而流式输出在这一帧之间还在把内容顶高：事件里读到的
   * scrollHeight 已经变大，scrollTop 却还是我们设的值，距底距离于是一下子超过粘附阈值，
   * onScroll 就把 isFollowing 打成 false——而重新吸附要求 4px 内，实际再也回不去。
   * 记住目标位置，认出这类"自己造成的滚动"并跳过脱离判定。
   */
  const expectedScrollTopRef = useRef<number | null>(null)
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
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      expectedScrollTopRef.current = target
      viewport.scrollTop = target
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
    const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    expectedScrollTopRef.current = target
    viewport.scrollTop = target
  }, [cancelScheduledScroll, updateFollowing])

  useEffect(() => {
    updateFollowing(true)
    scheduleScrollToBottom()
  }, [resetKey, scheduleScrollToBottom, updateFollowing])

  /*
   * 展开/收起折叠块必须保持点击位置不动。
   *
   * `<details>` 展开时内容在其内部向下撑开，浏览器本身不会移动已有元素；真正把视口拽走的是
   * 自动贴底：内容变高 → ResizeObserver 触发 → 仍处于跟随状态 → 视口被拉到底部，于是用户
   * 刚点的那一行往上跑，看起来就成了"向上展开"。
   *
   * 展开是"我要读这一段"的明确意图，和手动上翻同类，因此同样解除跟随；想回到实时输出可以
   * 点「回到底部」。toggle 事件不冒泡，这里用捕获阶段监听——捕获路径对非冒泡事件依然成立。
   */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleToggle = (): void => updateFollowing(false)
    viewport.addEventListener('toggle', handleToggle, true)
    return () => viewport.removeEventListener('toggle', handleToggle, true)
  }, [updateFollowing])

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
    const expected = expectedScrollTopRef.current
    expectedScrollTopRef.current = null
    // 停在我们刚设的位置 = 这次事件由程序化滚动产生，内容增高不代表用户想脱离。
    if (expected !== null && Math.abs(viewport.scrollTop - expected) <= 1) return
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

  const suspendFollowing = useCallback((): void => {
    updateFollowing(false)
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
    suspendFollowing,
  }
}
