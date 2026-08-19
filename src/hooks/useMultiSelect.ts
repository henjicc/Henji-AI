import { useCallback, useEffect, useState } from 'react'

export interface UseMultiSelectResult {
  active: boolean
  count: number
  isSelected: (id: string) => boolean
  isAllSelected: boolean
  enter: (initialId?: string) => void
  exit: () => void
  toggle: (id: string) => void
  toggleAll: () => void
}

/**
 * 卡片网格的多选状态机：进入/退出多选、单项切换、全选切换。
 * 只管状态，不管渲染——供 ProjectCardGrid 这类展示组件消费。
 */
export function useMultiSelect(ids: string[]): UseMultiSelectResult {
  const [active, setActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!active) return
    setSelectedIds((prev) => {
      const idSet = new Set(ids)
      const next = new Set([...prev].filter((id) => idSet.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [active, ids])

  const enter = useCallback((initialId?: string) => {
    setActive(true)
    setSelectedIds(initialId ? new Set([initialId]) : new Set())
  }, [])

  const exit = useCallback(() => {
    setActive(false)
    setSelectedIds(new Set())
  }, [])

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)))
  }, [ids])

  return {
    active,
    count: selectedIds.size,
    isSelected: (id: string) => selectedIds.has(id),
    isAllSelected: ids.length > 0 && selectedIds.size === ids.length,
    enter,
    exit,
    toggle,
    toggleAll,
  }
}
