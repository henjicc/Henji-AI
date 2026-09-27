import { useCallback, useEffect, useRef, type RefObject } from 'react'

import { useAutoScrollOnResize } from './useAutoScrollOnResize'

export function useGenerationAutoScroll(isTasksLoaded: boolean, taskCount: number): {
  listContainerRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
} {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const isUserAtBottom = useRef(true)
  const shouldAutoScroll = useCallback(() => isUserAtBottom.current, [])
  const scrollToBottom = useCallback((): void => {
    const element = listContainerRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [])
  const contentRef = useAutoScrollOnResize(shouldAutoScroll, scrollToBottom)

  useEffect(() => {
    const element = listContainerRef.current
    if (!element) return
    const update = () => {
      const threshold = 8
      // ResizeObserver 可能先于 React effect 清理执行，读取即时位置，避免把用户拉回底部。
      isUserAtBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop <= threshold
    }
    update()
    element.addEventListener('scroll', update)
    return () => element.removeEventListener('scroll', update)
  }, [])
  useEffect(() => {
    if (isTasksLoaded) scrollToBottom()
  }, [isTasksLoaded, scrollToBottom])
  useEffect(() => {
    if (isTasksLoaded && isUserAtBottom.current) scrollToBottom()
  }, [isTasksLoaded, scrollToBottom, taskCount])

  return { listContainerRef, contentRef }
}
