import { normalizeGenerationTaskStatus } from '@/core/assistant/externalWait'
import { registry } from '@/core/ModelRegistry'
import { generationService } from '@/core/services/GenerationService'
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

export interface ResolveGenerationModelInput extends Omit<GenerationPreparationInput, 'modelId'> {
  requestedModelId?: string
  preferredProviderIds?: string[]
  currentModelId?: string
}

export interface ResolvedGenerationModel {
  modelId: string
  providerId: string
  selection: 'requested' | 'preferred_provider' | 'current_draft' | 'configured_fallback'
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))]
}

export function selectExecutableGenerationModel(
  input: ResolveGenerationModelInput,
  configuredProviderIds: readonly string[],
): ResolvedGenerationModel {
  const configuredProviders = new Set(configuredProviderIds)
  const requested = input.requestedModelId ? registry.getModel(input.requestedModelId) : undefined
  if (input.requestedModelId && !requested) {
    throw new GenerationPreparationError('MODEL_NOT_FOUND', '指定的生成模型不存在', {
      modelId: input.requestedModelId,
    })
  }
  if (requested && !configuredProviders.has(requested.meta.provider)) {
    throw new GenerationPreparationError('INVALID_INPUT', '指定模型的供应商尚未配置，提交前已安全拒绝', {
      modelId: requested.meta.id,
      providerId: requested.meta.provider,
      reason: 'provider_not_configured',
    })
  }

  const allCandidates = registry.listAllModels().filter((model) => (
    model.meta.type === input.mediaType && configuredProviders.has(model.meta.provider)
  ))
  const preferredProviders = unique(input.preferredProviderIds ?? [])
  const ordered = requested
    ? [requested]
    : [
        ...preferredProviders.flatMap((providerId) => allCandidates.filter((model) => model.meta.provider === providerId)),
        ...allCandidates.filter((model) => model.meta.id === input.currentModelId),
        ...allCandidates,
      ]
  const seen = new Set<string>()
  const failures: Array<{ modelId: string; reason: string }> = []
  for (const model of ordered) {
    if (seen.has(model.meta.id)) continue
    seen.add(model.meta.id)
    try {
      prepareGenerationTask({
        modelId: model.meta.id,
        prompt: input.prompt,
        mediaType: input.mediaType,
        options: input.options,
      })
      const selection: ResolvedGenerationModel['selection'] = requested
        ? 'requested'
        : preferredProviders.includes(model.meta.provider)
          ? 'preferred_provider'
          : model.meta.id === input.currentModelId
            ? 'current_draft'
            : 'configured_fallback'
      return { modelId: model.meta.id, providerId: model.meta.provider, selection }
    } catch (error) {
      failures.push({
        modelId: model.meta.id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  throw new GenerationPreparationError('INVALID_INPUT', '没有已配置且兼容当前输入的生成模型', {
    mediaType: input.mediaType,
    configuredProviders: [...configuredProviders],
    failures: failures.slice(0, 12),
  })
}

async function resolveGenerationModel(input: ResolveGenerationModelInput): Promise<ResolvedGenerationModel> {
  return selectExecutableGenerationModel(input, await generationService.getConfiguredProviders())
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

  resolveModel(input: ResolveGenerationModelInput) {
    return resolveGenerationModel(input)
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
