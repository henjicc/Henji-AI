import type React from 'react'
import { useCallback, useState } from 'react'
import type { GenerationTask } from '../types'

export interface UseTaskStateReturn {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  taskProgress: Record<string, number>
  setTaskProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
}

export function useTaskState(): UseTaskStateReturn {
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [taskProgress, setTaskProgress] = useState<Record<string, number>>({})

  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>): void => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)))
  }, [])

  const updateProgress = useCallback((taskId: string, progress: number): void => {
    setTaskProgress((prev) => ({ ...prev, [taskId]: progress }))
  }, [])

  return { tasks, setTasks, taskProgress, setTaskProgress, updateTask, updateProgress }
}
