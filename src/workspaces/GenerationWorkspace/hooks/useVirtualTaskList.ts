import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range, type Virtualizer } from '@tanstack/react-virtual'
import type { GenerationTask } from '../types'
import { useTaskListRetention, type TaskListRetention } from './useTaskListRetention'
import { registerGenerationTaskReveal } from '../application/generationTaskNavigation'

export function useVirtualTaskList(tasks: GenerationTask[], scrollContainerRef: RefObject<HTMLDivElement>): {
  listRef: RefObject<HTMLDivElement>
  retention: TaskListRetention
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  scrollMargin: number
} {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  // 父级 DOM ref 在子级首次 layout effect 之后才可能绑定。
  useEffect(() => setScrollElement(scrollContainerRef.current), [scrollContainerRef])
  const previousIds = useRef<readonly string[]>([])
  const ids = useMemo(() => {
    if (previousIds.current.length === tasks.length && tasks.every((task, index) => task.id === previousIds.current[index])) {
      return previousIds.current
    }
    previousIds.current = tasks.map(task => task.id)
    return previousIds.current
  }, [tasks])
  const indexes = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids])
  const { retention, retained } = useTaskListRetention(ids)
  const rangeExtractor = useCallback((range: Range) => {
    const included = new Set(defaultRangeExtractor(range))
    for (const { id, focused } of retained) {
      const index = indexes.get(id)
      if (index === undefined) continue
      included.add(index)
      // Tab / Shift+Tab 仍可沿任务顺序进入相邻卡片，再由浏览器滚动到焦点。
      if (focused) {
        if (index > 0) included.add(index - 1)
        if (index + 1 < range.count) included.add(index + 1)
      }
    }
    return [...included].sort((a, b) => a - b)
  }, [indexes, retained])
  const [scrollMargin, setScrollMargin] = useState(0)
  const hasTasks = tasks.length > 0
  useLayoutEffect(() => {
    const list = listRef.current
    const scroller = scrollElement
    if (!list || !scroller) return
    const measure = () => setScrollMargin(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    if (list.parentElement) observer.observe(list.parentElement)
    return () => observer.disconnect()
  }, [hasTasks, scrollElement])
  const getItemKey = useCallback((index: number) => ids[index], [ids])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: tasks.length,
    getScrollElement: () => scrollElement,
    getItemKey,
    estimateSize: () => 360,
    overscan: 4,
    gap: 24,
    scrollMargin,
    rangeExtractor,
  })
  // 仅补偿完整位于视口上方的尺寸变化，当前阅读卡片的顶部保持不动。
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => item.end <= (instance.scrollOffset ?? 0)
  useLayoutEffect(() => registerGenerationTaskReveal((taskId) => {
    const index = indexes.get(taskId)
    if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'center' })
  }), [indexes, virtualizer])
  return { listRef, retention, virtualizer, scrollMargin }
}
