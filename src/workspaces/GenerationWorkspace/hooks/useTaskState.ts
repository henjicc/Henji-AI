import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'
import { persistGenerationTask, deletePersistedGenerationTask } from './useTaskHistory'
import type { GenerationTask, ResultImageDimensions } from '../types'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import { publishVisibleGenerationTaskStatus } from '../application/visibleGenerationTaskCommand'

export interface UseTaskStateReturn {
  tasks: GenerationTask[]
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  hydrateTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  rememberResultImageDimensions: (
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ) => void
}

export function useTaskState(): UseTaskStateReturn {
  const [tasks, setReactTasks] = useState<GenerationTask[]>([])
  const latest = useRef(tasks)
  const hydrateTasks = useCallback<React.Dispatch<React.SetStateAction<GenerationTask[]>>>((input) => {
    latest.current = typeof input === 'function' ? input(latest.current) : input
    setReactTasks(latest.current)
  }, [])
  const setTasks = useCallback<React.Dispatch<React.SetStateAction<GenerationTask[]>>>((input) => {
    const previous = latest.current
    const next = typeof input === 'function' ? input(previous) : input
    const ids = new Set(next.map((task) => task.id))
    const report = (error: unknown): void => createLogger('features.generation.persistence').error('生成任务保存失败，保留内存结果', error, { event: 'generation.history.failed' })
    for (const task of next) if (!previous.includes(task)) void persistGenerationTask(task).catch(report)
    for (const task of previous) if (!ids.has(task.id)) void deletePersistedGenerationTask(task.id).catch(report)
    latest.current = next
    setReactTasks(next)
  }, [])

  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>): void => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)))
    if (updates.status && !['success', 'error'].includes(updates.status)) publishVisibleGenerationTaskStatus({
      taskId,
      status: updates.status,
      resultAvailable: Boolean(updates.result),
      errorCode: updates.error ? 'GENERATION_FAILED' : null,
      errorMessage: updates.error?.slice(0, 1_000) ?? null,
    })
  }, [setTasks])

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
  }, [setTasks])

  return {
    tasks,
    setTasks,
    hydrateTasks,
    updateTask,
    updateProgress,
    rememberResultImageDimensions,
  }
}
