import { useState, useCallback } from 'react'

/**
 * 历史记录管理
 * 职责：管理编辑操作的撤销/重做
 */

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export const useHistory = <T,>(initialState: T) => {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: []
  })

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const set = useCallback((newState: T) => {
    setHistory(prev => ({
      past: [...prev.past, prev.present],
      present: newState,
      future: []
    }))
  }, [])

  const undo = useCallback(() => {
    if (!canUndo) return

    setHistory(prev => {
      const previous = prev.past[prev.past.length - 1]
      const newPast = prev.past.slice(0, prev.past.length - 1)

      return {
        past: newPast,
        present: previous,
        future: [prev.present, ...prev.future]
      }
    })
  }, [canUndo])

  const redo = useCallback(() => {
    if (!canRedo) return

    setHistory(prev => {
      const next = prev.future[0]
      const newFuture = prev.future.slice(1)

      return {
        past: [...prev.past, prev.present],
        present: next,
        future: newFuture
      }
    })
  }, [canRedo])

  const reset = useCallback((newState: T) => {
    setHistory({
      past: [],
      present: newState,
      future: []
    })
  }, [])

  return {
    state: history.present,
    set,
    undo,
    redo,
    canUndo,
    canRedo,
    reset
  }
}
