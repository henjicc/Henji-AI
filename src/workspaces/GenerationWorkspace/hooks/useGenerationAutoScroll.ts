import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import { useAutoScrollOnResize } from './useAutoScrollOnResize'

export function useGenerationAutoScroll(isTasksLoaded: boolean, taskCount: number): {
  listContainerRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
} {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const isUserAtBottom = useRef(true)
  const lastPosition = useRef({ top: 0, height: 0 })
  const shouldAutoScroll = useCallback(() => isUserAtBottom.current, [])
  const scrollToBottom = useCallback((): void => {
    const element = listContainerRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    lastPosition.current = { top: element.scrollTop, height: element.scrollHeight }
  }, [])
  const contentRef = useAutoScrollOnResize(shouldAutoScroll, scrollToBottom)

  useEffect(() => {
    const element = listContainerRef.current
    if (!element) return
    const update = () => {
      const threshold = 8
      const { scrollTop: top, scrollHeight: height, clientHeight } = element
      if (height - clientHeight - top <= threshold) isUserAtBottom.current = true
      // 虚拟卡片测量/媒体载入也会触发 scroll；内容变高不代表用户离开底部。
      // 只有尺寸不变时真正向上滚动才解除跟随，避免首屏测量后停在倒数几条。
      else if (height === lastPosition.current.height && top < lastPosition.current.top) isUserAtBottom.current = false
      lastPosition.current = { top, height }
    }
    update()
    element.addEventListener('scroll', update)
    return () => element.removeEventListener('scroll', update)
  }, [])
  useLayoutEffect(() => {
    if (isTasksLoaded) {
      isUserAtBottom.current = true
      scrollToBottom()
    }
  }, [isTasksLoaded, scrollToBottom])
  useEffect(() => {
    if (isTasksLoaded && isUserAtBottom.current) scrollToBottom()
  }, [isTasksLoaded, scrollToBottom, taskCount])

  return { listContainerRef, contentRef }
}
