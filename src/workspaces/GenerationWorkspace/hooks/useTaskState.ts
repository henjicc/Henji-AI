import type React from 'react'
import { useCallback, useState } from 'react'
import type { GenerationTask } from '../types'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'

export interface UseTaskStateReturn {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
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

  return { tasks, setTasks, updateTask, updateProgress }
}
