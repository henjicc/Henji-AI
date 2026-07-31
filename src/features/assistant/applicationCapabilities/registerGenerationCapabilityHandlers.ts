import {
  GenerationPreparationError,
  getGenerationModelSchema,
  prepareGenerationTask,
  searchGenerationModelCatalog,
} from '@/core/assistant/generationPreparation'
import { createGenerationTaskRecoveryAdvice } from '@/core/assistant/generationTaskRecovery'
import { switchWorkspace } from '@/stores/navigationStore'
import {
  cancelVisibleGenerationTask,
  getVisibleGenerationTask,
  runVisibleGenerationTaskCommand,
} from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'

interface SearchModelsInput {
  query: string
  mediaType?: 'image' | 'video' | 'audio'
  providerId?: string
  tags?: string[]
  sortBy?: 'registry' | 'recommended' | 'lowest_estimated_price'
  cursor: number
  limit: number
}

interface GenerationInput {
  modelId: string
  prompt: string
  mediaType: 'image' | 'video' | 'audio'
  params?: Record<string, unknown>
}

export function registerGenerationCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('switch_workspace', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      workspaceId: 'generation' | 'nodes' | 'tools' | 'assets'
    }>('switch_workspace', input)
    switchWorkspace(parsed.workspaceId)
    return { workspace: parsed.workspaceId }
  })

  registrar.registerHandler('search_models', (input) => {
    const parsed = parseCapabilityInput<SearchModelsInput>('search_models', input)
    const search = searchGenerationModelCatalog(parsed)
    const start = parsed.cursor
    const models = search.models.slice(start, start + parsed.limit)
    return {
      catalogVersion: 'model-registry/v1',
      models,
      nextCursor: start + models.length < search.models.length ? start + models.length : null,
      selectionContext: {
        requestedMediaType: parsed.mediaType ?? null,
        requestedProviderId: parsed.providerId ?? null,
        appliedProviderId: search.appliedProviderId,
        providerIdNormalized: search.providerIdNormalized,
        requestedTags: parsed.tags ?? [],
        requestedSortBy: parsed.sortBy ?? 'registry',
        requestedQuery: parsed.query,
        matchedQueryTerms: search.matchedQueryTerms,
        ignoredQueryTerms: search.ignoredQueryTerms,
        compatibleCandidateCount: search.models.length,
      },
    }
  })

  registrar.registerHandler('get_model_schema', (input) => {
    const parsed = parseCapabilityInput<{ modelId: string }>('get_model_schema', input)
    return getGenerationModelSchema(parsed.modelId)
  })

  registrar.registerHandler('prepare_generation_task', (input) => {
    const parsed = parseCapabilityInput<GenerationInput>('prepare_generation_task', input)
    return {
      preparation: prepareGenerationTask({
        modelId: parsed.modelId,
        prompt: parsed.prompt,
        mediaType: parsed.mediaType,
        options: parsed.params,
      }),
    }
  })

  registrar.registerHandler('create_visible_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<GenerationInput>('create_visible_generation_task', input)
    const preparation = prepareGenerationTask({
      modelId: parsed.modelId,
      prompt: parsed.prompt,
      mediaType: parsed.mediaType,
      options: parsed.params,
    })
    const taskId = await runVisibleGenerationTaskCommand({
      input: parsed.prompt,
      model: parsed.modelId,
      type: parsed.mediaType,
      options: preparation.options as DynamicValue,
    })
    if (!taskId) {
      throw new GenerationPreparationError(
        'INVALID_INPUT',
        '生成任务未创建，请检查输入和当前模式'
      )
    }
    return { taskId, status: 'submitted' }
  })

  registrar.registerHandler('get_generation_task', (input) => {
    const parsed = parseCapabilityInput<{ taskId: string }>('get_generation_task', input)
    const task = getVisibleGenerationTask(parsed.taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    return {
      task: {
        ...task,
        recovery: createGenerationTaskRecoveryAdvice(task),
      },
    }
  })

  registrar.registerHandler('cancel_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      taskId: string
      reason: string
    }>('cancel_generation_task', input)
    return await cancelVisibleGenerationTask(parsed.taskId, parsed.reason)
  })
}
