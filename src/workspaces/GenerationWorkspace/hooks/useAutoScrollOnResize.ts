import { useEffect, useRef, type RefObject } from 'react'

export function useAutoScrollOnResize(
  shouldAutoScroll: () => boolean,
  scrollToBottom: () => void
): RefObject<HTMLDivElement> {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl) return
    const ro = new ResizeObserver(() => {
      if (shouldAutoScroll()) scrollToBottom()
    })
    ro.observe(contentEl)
    return () => ro.disconnect()
  }, [shouldAutoScroll, scrollToBottom])

  return contentRef
}
