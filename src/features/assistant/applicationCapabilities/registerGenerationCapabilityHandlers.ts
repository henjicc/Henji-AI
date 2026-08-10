import { registry } from '@/core/ModelRegistry'
import {
  createMediaGeneratorPromptReferences,
} from '@/components/MediaGenerator/promptState'
import { toLegacyPromptString } from '@/core/inputs/promptDocument'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { switchWorkspace } from '@/stores/navigationStore'

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
  modelId?: string
  prompt?: string
  mediaType?: 'image' | 'video' | 'audio'
  params?: Record<string, unknown>
}

interface ResolvedGenerationInput {
  modelId: string
  prompt: string
  mediaType: 'image' | 'video' | 'audio'
  options?: Record<string, unknown>
}

/*
 * 放宽提交（5.4）：modelId/prompt/mediaType 省略时用当前生成草稿（generationDraftStore）
 * 补全，让助手能像人一样先逐步搭建输入（写提示词、选模型、上传媒体）再提交，不必每次
 * 一次性传全部参数。
 *
 * params 省略时用草稿里已上传的媒体路径兜底；params 一旦显式传入就按调用方给的原样
 * 使用，不与草稿合并——这是为了不破坏"传参数时仍按传入值走"的兼容性（任务文档明确要求，
 * 也是现有调用方不受影响的关键：老代码一直显式传 modelId/prompt/mediaType/params 四项，
 * 这里的默认值分支永远不会命中它们）。
 */
function resolveGenerationInput(input: GenerationInput): ResolvedGenerationInput {
  const draft = useGenerationDraftStore.getState().draft

  const modelId = input.modelId ?? draft.selectedModel
  if (!modelId) throw new Error('INVALID_INPUT:未提供 modelId，且当前生成草稿未选中模型')

  const prompt = input.prompt ?? toLegacyPromptString(draft.promptDocument, {
    references: createMediaGeneratorPromptReferences(draft.uploadedPromptImages),
  })

  const mediaType = input.mediaType ?? registry.getModel(modelId)?.meta.type
  if (!mediaType) throw new Error(`INVALID_INPUT:未提供 mediaType，且无法从模型 ${modelId} 推断`)

  const options = input.params ?? {
    uploadedImages: draft.uploadedPromptImages.map((image) => image.url),
    uploadedFilePaths: draft.uploadedFilePaths,
    uploadedVideos: draft.uploadedVideos,
    uploadedVideoFilePaths: draft.uploadedVideoFilePaths,
    uploadedAudios: draft.uploadedAudios,
    uploadedAudioFilePaths: draft.uploadedAudioFilePaths,
  }

  return { modelId, prompt, mediaType, options }
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
    const search = generationApplicationService.searchModels(parsed)
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
    return generationApplicationService.getModelSchema(parsed.modelId)
  })

  registrar.registerHandler('prepare_generation_task', (input) => {
    const parsed = parseCapabilityInput<GenerationInput>('prepare_generation_task', input)
    return {
      preparation: generationApplicationService.prepare(resolveGenerationInput(parsed)),
    }
  })

  registrar.registerHandler('create_visible_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<GenerationInput>('create_visible_generation_task', input)
    return await generationApplicationService.submit(resolveGenerationInput(parsed))
  })

  registrar.registerHandler('get_generation_task', (input) => {
    const parsed = parseCapabilityInput<{ taskId: string }>('get_generation_task', input)
    return { task: generationApplicationService.getTask(parsed.taskId) }
  })

  registrar.registerHandler('cancel_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      taskId: string
      reason: string
    }>('cancel_generation_task', input)
    return await generationApplicationService.cancelTask(parsed.taskId, parsed.reason)
  })
}
