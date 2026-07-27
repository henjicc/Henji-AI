import type React from 'react'
import { useCallback, useState } from 'react'
import type { GenerationTask, ResultImageDimensions } from '../types'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'

export interface UseTaskStateReturn {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  rememberResultImageDimensions: (
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ) => void
}

export function useTaskState(): UseTaskStateReturn {
  const [tasks, setTasks] = useState<GenerationTask[]>([])

  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>): void => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)))
  }, [])

  // 进度是高频瞬态状态：写独立 store 而非 setTasks，避免每次进度回调都重建 tasks 数组、
  // 触发整个工作区宽重渲染（详见 generationTaskProgressStore 的注释）。
  const updateProgress = useCallback((taskId: string, progress: number): void => {
    useGenerationTaskProgressStore.getState().setProgress(taskId, progress)
  }, [])

  const rememberResultImageDimensions = useCallback((
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ): void => {
    setTasks((currentTasks) => {
      let changed = false
      const nextTasks = currentTasks.map((task) => {
        if (task.id !== taskId) return task
        const currentDimensions = task.options?.resultImageDimensions
        const existing = Array.isArray(currentDimensions) ? currentDimensions[imageIndex] : undefined
        if (existing?.width === dimensions.width && existing.height === dimensions.height) return task

        const nextDimensions = Array.isArray(currentDimensions) ? [...currentDimensions] : []
        nextDimensions[imageIndex] = dimensions
        changed = true
        return {
          ...task,
          options: {
            ...(task.options ?? {}),
            resultImageDimensions: nextDimensions,
          },
        }
      })
      return changed ? nextTasks : currentTasks
    })
  }, [])

  return {
    tasks,
    setTasks,
    updateTask,
    updateProgress,
    rememberResultImageDimensions,
  }
}
