import { useCallback } from 'react'
import { removeGenerationHistoryRecords } from '@/services/generationHistoryCleanup'
import type { GenerationTask } from '../types'

export interface UseTaskCleanupParams {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  clearTaskProgress?: (taskId: string) => void
}

export interface UseTaskCleanupReturn {
  deleteTask: (taskId: string) => Promise<void>
  clearFailedTasks: () => Promise<void>
  clearAllTasks: () => Promise<void>
}

export function useTaskCleanup({ tasks, setTasks, clearTaskProgress }: UseTaskCleanupParams): UseTaskCleanupReturn {
  const removeRecords = useCallback(async (ids: readonly string[]): Promise<void> => {
    const removed = new Set(ids)
    setTasks(current => removeGenerationHistoryRecords(current, removed))
    ids.forEach(id => clearTaskProgress?.(id))
  }, [clearTaskProgress, setTasks])

  const deleteTask = useCallback((id: string): Promise<void> => removeRecords([id]), [removeRecords])
  const clearFailedTasks = useCallback((): Promise<void> =>
    removeRecords(tasks.filter(task => task.status === 'error').map(task => task.id)), [removeRecords, tasks])
  const clearAllTasks = useCallback((): Promise<void> =>
    removeRecords(tasks.map(task => task.id)), [removeRecords, tasks])

  return { deleteTask, clearFailedTasks, clearAllTasks }
}
