import { useEffect, useMemo } from 'react'

import type { ScopedTextHistoryBinding } from '@/components/ui/useScopedTextHistory'
import { useCanvasStore } from '@/stores/canvasStore'

export interface CanvasEditHistoryBinding {
  historyGroup: string
  onEditEnd: () => void
}

export function createCanvasTextHistoryGroup(nodeId: string, fieldPath: string): string {
  return `canvas-text:${nodeId}:${fieldPath}`
}

/** 编辑器内部保留字符级 history，画布只在一次 focus session 结束时关闭快照分组。 */
export function useCanvasEditHistory(historyGroup: string): CanvasEditHistoryBinding {
  const endHistoryGroup = useCanvasStore((state) => state.endHistoryGroup)
  useEffect(() => () => endHistoryGroup(historyGroup), [endHistoryGroup, historyGroup])
  return useMemo(() => ({
    historyGroup,
    onEditEnd: () => endHistoryGroup(historyGroup),
  }), [endHistoryGroup, historyGroup])
}

export function useCanvasTextHistory(
  historyGroup: string,
  onValueChange: (value: string) => void
): ScopedTextHistoryBinding {
  const editHistory = useCanvasEditHistory(historyGroup)
  return useMemo(() => ({
    onValueChange,
    onEditEnd: editHistory.onEditEnd,
  }), [editHistory.onEditEnd, onValueChange])
}
