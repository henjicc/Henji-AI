import { useState, useCallback } from 'react'

/**
 * 选区管理 Hook
 * 职责：管理图片编辑器中的选区
 */

interface Selection {
  x: number
  y: number
  width: number
  height: number
}

export const useSelection = () => {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  const startSelection = useCallback((x: number, y: number) => {
    setIsSelecting(true)
    setSelection({ x, y, width: 0, height: 0 })
  }, [])

  const updateSelection = useCallback((x: number, y: number) => {
    if (!isSelecting || !selection) return

    setSelection(prev => {
      if (!prev) return null
      return {
        ...prev,
        width: x - prev.x,
        height: y - prev.y
      }
    })
  }, [isSelecting, selection])

  const endSelection = useCallback(() => {
    setIsSelecting(false)
  }, [])

  const clearSelection = useCallback(() => {
    setSelection(null)
    setIsSelecting(false)
  }, [])

  const hasSelection = selection !== null && selection.width !== 0 && selection.height !== 0

  return {
    selection,
    isSelecting,
    hasSelection,
    startSelection,
    updateSelection,
    endSelection,
    clearSelection
  }
}
