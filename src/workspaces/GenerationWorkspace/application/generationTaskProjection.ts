import type { GenerationTask } from '../types'
import { publishGenerationTaskStatus, removeGenerationTaskStatus } from '@/features/generation/application/generationTaskStatusRegistry'
import { publishVisibleGenerationTaskStatus } from './visibleGenerationTaskCommand'

// 任务服务持有当前事实；React 列表与实体反射都是投影，不反向发布终态。
let tasks: GenerationTask[] = []
let taskIndex = new Map<string, GenerationTask>()
const listeners = new Set<() => void>()

export function readGenerationTasks(): GenerationTask[] { return tasks }

export function subscribeGenerationTasks(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function replaceGenerationTasks(next: GenerationTask[]): void {
  const prior = taskIndex
  taskIndex = new Map(next.map(task => [task.id, task]))
  for (const id of prior.keys()) if (!taskIndex.has(id)) removeGenerationTaskStatus(id)
  tasks = next
  for (const task of next) {
    if (prior.get(task.id) === task) continue
    const status = {
      taskId: task.id, status: task.status, progress: task.progress ?? 0,
      modelId: task.model, mediaType: task.type, resultAvailable: Boolean(task.result),
      errorCode: task.status === 'error' ? 'GENERATION_FAILED' : null,
      errorMessage: task.error?.slice(0, 1_000) ?? null,
      ...(task.options?.__canvasGeneration ? { origin: 'canvas' as const } : {}),
    }
    publishGenerationTaskStatus(status)
    publishVisibleGenerationTaskStatus(status)
  }
  for (const listener of listeners) listener()
}

export function publishGenerationTask(task: GenerationTask): void {
  const index = tasks.findIndex(item => item.id === task.id)
  const next = [...tasks]
  if (index < 0) next.push(task)
  else next[index] = task
  replaceGenerationTasks(next)
}
