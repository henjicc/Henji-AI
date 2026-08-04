import { useCallback, useEffect, useRef, useState } from 'react'

import { useAutoScrollOnResize } from './useAutoScrollOnResize'

export function useGenerationAutoScroll(isTasksLoaded: boolean, taskCount: number) {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)
  const scrollToBottom = useCallback((): void => {
    const element = listContainerRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [])
  const contentRef = useAutoScrollOnResize(isUserAtBottom, scrollToBottom)

  useEffect(() => {
    const element = listContainerRef.current
    if (!element) return
    const update = () => {
      const threshold = 8
      setIsUserAtBottom(element.scrollHeight - element.clientHeight - element.scrollTop <= threshold)
    }
    update()
    element.addEventListener('scroll', update)
    return () => element.removeEventListener('scroll', update)
  }, [])
  useEffect(() => {
    if (isTasksLoaded) scrollToBottom()
  }, [isTasksLoaded, scrollToBottom])
  useEffect(() => {
    if (isTasksLoaded && isUserAtBottom) scrollToBottom()
  }, [isTasksLoaded, isUserAtBottom, scrollToBottom, taskCount])

  return { listContainerRef, contentRef }
}
