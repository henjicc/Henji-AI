import { useEffect, useRef, type RefObject } from 'react'

export function useAutoScrollOnResize(
  shouldAutoScroll: boolean,
  scrollToBottom: () => void
): RefObject<HTMLDivElement> {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shouldAutoScroll) return
    const contentEl = contentRef.current
    if (!contentEl) return
    const ro = new ResizeObserver(() => {
      scrollToBottom()
    })
    ro.observe(contentEl)
    return () => ro.disconnect()
  }, [shouldAutoScroll, scrollToBottom])

  return contentRef
}
