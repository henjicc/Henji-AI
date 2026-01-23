import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * 滚动行为 Hook
 * 职责：管理自动滚动到底部的行为
 */

export const useScrollBehavior = (enabled: boolean = true) => {
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)

  const scrollToBottom = useCallback((smooth: boolean = true) => {
    if (!scrollContainerRef.current) return

    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    })
  }, [])

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

    // 如果用户滚动到底部，启用自动滚动
    if (isAtBottom) {
      setShouldAutoScroll(true)
      isUserScrollingRef.current = false
    } else {
      // 如果用户向上滚动，禁用自动滚动
      if (isUserScrollingRef.current) {
        setShouldAutoScroll(false)
      }
    }
  }, [])

  const handleWheel = useCallback(() => {
    isUserScrollingRef.current = true
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !enabled) return

    container.addEventListener('scroll', handleScroll)
    container.addEventListener('wheel', handleWheel)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('wheel', handleWheel)
    }
  }, [enabled, handleScroll, handleWheel])

  // 自动滚动到底部
  useEffect(() => {
    if (shouldAutoScroll && enabled) {
      scrollToBottom()
    }
  }, [shouldAutoScroll, enabled, scrollToBottom])

  return {
    scrollContainerRef,
    shouldAutoScroll,
    setShouldAutoScroll,
    scrollToBottom
  }
}
