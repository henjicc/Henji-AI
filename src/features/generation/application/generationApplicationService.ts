import { normalizeGenerationTaskStatus } from '@/core/assistant/externalWait'
import {
  cancelVisibleGenerationTask,
  getVisibleGenerationTask,
  listVisibleGenerationTasks,
  runVisibleGenerationTaskCommand,
  type VisibleGenerationTaskSummary,
} from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

import {
  GenerationPreparationError,
  getGenerationModelSchema,
  prepareGenerationTask,
  searchGenerationModelCatalog,
  type GenerationModelSearchInput,
  type GenerationPreparationInput,
} from './generationPreparationService'
import { createGenerationTaskRecoveryAdvice } from './generationTaskRecovery'

export interface GenerationTaskSnapshot extends VisibleGenerationTaskSummary {
  revision: number
  normalizedStatus: string
  cancellable: boolean
  waitingExternal: boolean
  taskRef: { kind: 'generation.task'; id: string }
  resultRef: { kind: 'generation.result'; id: string } | null
  recovery: ReturnType<typeof createGenerationTaskRecoveryAdvice>
}

function taskRevision(task: VisibleGenerationTaskSummary): number {
  const seed = JSON.stringify(task)
  return [...seed].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381)
}

function snapshot(task: VisibleGenerationTaskSummary): GenerationTaskSnapshot {
  const normalizedStatus = normalizeGenerationTaskStatus(task.status) ?? task.status
  return {
    ...task,
    revision: taskRevision(task),
    normalizedStatus,
    cancellable: ['queued', 'pending', 'generating'].includes(normalizedStatus),
    waitingExternal: ['queued', 'pending', 'generating'].includes(normalizedStatus),
    taskRef: { kind: 'generation.task', id: task.taskId },
    resultRef: task.resultAvailable ? { kind: 'generation.result', id: task.taskId } : null,
    recovery: createGenerationTaskRecoveryAdvice(task),
  }
}

export const generationApplicationService = {
  searchModels(input: GenerationModelSearchInput) {
    return searchGenerationModelCatalog(input)
  },

  getModelSchema(modelId: string) {
    return getGenerationModelSchema(modelId)
  },

  prepare(input: GenerationPreparationInput) {
    return prepareGenerationTask(input)
  },

  async submit(input: GenerationPreparationInput): Promise<{ taskId: string; status: 'submitted'; taskRef: { kind: 'generation.task'; id: string } }> {
    const preparation = prepareGenerationTask(input)
    const taskId = await runVisibleGenerationTaskCommand({
      input: input.prompt,
      model: input.modelId,
      type: input.mediaType,
      options: preparation.options as DynamicValue,
    })
    if (!taskId) {
      throw new GenerationPreparationError('INVALID_INPUT', '生成任务未创建，请检查输入和当前模式')
    }
    return { taskId, status: 'submitted', taskRef: { kind: 'generation.task', id: taskId } }
  },

  listTasks(): GenerationTaskSnapshot[] {
    return listVisibleGenerationTasks().map(snapshot)
  },

  getTask(taskId: string): GenerationTaskSnapshot {
    const task = getVisibleGenerationTask(taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    return snapshot(task)
  },

  async cancelTask(taskId: string, reason: string): Promise<Record<string, unknown>> {
    const before = this.getTask(taskId)
    if (!before.cancellable) throw new Error('TASK_NOT_CANCELLABLE')
    return await cancelVisibleGenerationTask(taskId, reason)
  },
}
