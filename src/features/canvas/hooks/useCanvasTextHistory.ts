import { useEffect, useMemo } from 'react'

import type { ScopedTextHistoryBinding } from '@/components/ui/useScopedTextHistory'
import { useCanvasStore } from '@/stores/canvasStore'

export function createCanvasTextHistoryGroup(nodeId: string, fieldPath: string): string {
  return `canvas-text:${nodeId}:${fieldPath}`
}

export function useCanvasTextHistory(
  historyGroup: string,
  onValueChange: (value: string) => void
): ScopedTextHistoryBinding {
  const endHistoryGroup = useCanvasStore((state) => state.endHistoryGroup)
  useEffect(() => () => endHistoryGroup(historyGroup), [endHistoryGroup, historyGroup])
  return useMemo(() => ({
    onValueChange,
    onEditEnd: () => endHistoryGroup(historyGroup),
  }), [endHistoryGroup, historyGroup, onValueChange])
}
