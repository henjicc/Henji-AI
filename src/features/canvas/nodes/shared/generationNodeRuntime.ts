import { createPlainTextPromptDocument, toModelPromptText } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import type { BuiltinModelType } from '@/core/types'
import { resolveCanvasCapabilityModelCandidates } from '@/features/canvas/capabilities'
import type { CanvasImageCapabilityDefinition } from '@/features/canvas/capabilities/types'
import { resolveCanvasGenerationPrompt } from '@/features/canvas/application/generationPromptDocument'
import { collectInputMedia } from '@/features/canvas/application/graphMediaResolver'
import {
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver'
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels'
import type { MediaKind } from '@/features/canvas/domain/nodePorts'
import {
  MODEL_PARAM_ID,
  PROMPT_PARAM_ID,
  type RowMediaKind,
} from '@/features/canvas/domain/socketTypes'
import { resolveNodeModelExecutionParamValues } from '@/features/canvas/params/useNodeModelParams'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'

import type { GenerationNodeShellData } from './useGenerationPromptDocument'

export interface ResolveGenerationNodeRuntimeInput {
  nodeId: string
  modelType: BuiltinModelType
  acceptedKinds: readonly MediaKind[]
  acceptedMediaKinds: readonly RowMediaKind[]
  capability: CanvasImageCapabilityDefinition | null
  showModelInput: boolean
}

/** 始终基于当前 store 快照解析，供依赖刚完成后的同一微任务直接执行。 */
export function resolveGenerationNodeRuntime(input: ResolveGenerationNodeRuntimeInput) {
  const canvas = useCanvasStore.getState()
  const latestNode = canvas.nodes.find((node) => node.id === input.nodeId)
  if (!latestNode) throw new Error(`画布执行节点不存在：${input.nodeId}`)
  const data = latestNode.data as GenerationNodeShellData
  const injectedValues = collectInputValues(input.nodeId, canvas.nodes, canvas.edges)
  const connectedParamIds = getConnectedParamIds(input.nodeId, canvas.edges)
  const modelOverride = input.showModelInput
    && connectedParamIds.has(MODEL_PARAM_ID)
    && typeof injectedValues[MODEL_PARAM_ID] === 'string'
    ? injectedValues[MODEL_PARAM_ID] as string
    : null
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : ''
  const compatibleIds = input.capability
    ? new Set(resolveCanvasCapabilityModelCandidates(
        registry.getModelsByType(input.modelType),
        input.capability.modelPolicy,
      ).candidates.map(({ model }) => model.meta.id))
    : null
  const fallbackModelId = getDefaultModelId(input.modelType)
  const selectedModelId = storedModelId
    && registry.getModel(storedModelId)
    && (!compatibleIds || compatibleIds.has(storedModelId))
    ? storedModelId
    : compatibleIds?.has(fallbackModelId)
      ? fallbackModelId
      : compatibleIds?.values().next().value ?? fallbackModelId
  const modelId = modelOverride ?? selectedModelId
  const model = registry.getModel(modelId)
  const incomingMedia = collectInputMedia(input.nodeId, canvas.nodes, canvas.edges)
    .filter((output) => input.acceptedKinds.includes(output.kind))
  const carrier = resolveCanvasGenerationPrompt({
    nodeId: input.nodeId,
    document: data.promptDocument,
    legacyText: typeof data.prompt === 'string' ? data.prompt : '',
    bindings: data.promptMediaBindings,
    mediaInputs: data.mediaInputs ?? {},
    incomingMedia,
    acceptedMediaKinds: input.acceptedMediaKinds,
  })
  const promptIsOverridden = connectedParamIds.has(PROMPT_PARAM_ID)
  const promptOverride = promptIsOverridden ? injectedValues[PROMPT_PARAM_ID] : undefined
  const promptDocument = promptIsOverridden && typeof promptOverride === 'string'
    ? createPlainTextPromptDocument(promptOverride)
    : carrier.document
  const media = {
    images: carrier.mediaUrls.image,
    videos: carrier.mediaUrls.video,
    audios: carrier.mediaUrls.audio,
  }

  return {
    data,
    injectedValues,
    promptIsOverridden,
    promptOverride,
    promptDocument,
    promptReferences: carrier.references,
    ...media,
    modelId,
    model,
    providerKeyConfigured: Boolean(
      model && useSettingsStore.getState().providerKeyStatus[model.meta.provider] === true,
    ),
    modelParamValues: resolveNodeModelExecutionParamValues(modelId, data.params, media),
  }
}

const RUNTIME_SIGNATURE_EXCLUDED_DATA_KEYS = new Set([
  'displayName',
  'aspectRatio',
  'isSizeManuallyAdjusted',
  'generationUi',
  'params',
  'modelId',
  'prompt',
  'text',
  'promptDocument',
  'promptMediaBindings',
  'mediaInputs',
  'latestExecution',
  'dependencyRunPolicy',
  'fixedResult',
  'isGenerating',
  'generationStartedAt',
  'generationDurationMs',
  'generationError',
  'serverTaskId',
  'serverTaskModelId',
  'imageUrl',
  'previewImageUrl',
  'videoUrl',
  'audioUrl',
  'sourceFileName',
  'multiAngleBatch',
  'multiAngleResultPlaceholderId',
])

/** 标准生成节点按最终运行时语义签名，避免等价的参数联动回写造成伪失效。 */
export function createGenerationNodeRuntimeSignaturePayload(
  runtime: ReturnType<typeof resolveGenerationNodeRuntime>,
): Record<string, unknown> {
  const semanticData = Object.fromEntries(
    Object.entries(runtime.data as DynamicValueMap)
      .filter(([key]) => !RUNTIME_SIGNATURE_EXCLUDED_DATA_KEYS.has(key)),
  )
  return {
    contractVersion: 3,
    model: runtime.model ? {
      id: runtime.model.meta.id,
      canonicalModelId: runtime.model.meta.canonicalModelId,
      provider: runtime.model.meta.provider,
    } : { id: runtime.modelId },
    prompt: toModelPromptText(runtime.promptDocument, { references: runtime.promptReferences }),
    media: {
      images: runtime.images,
      videos: runtime.videos,
      audios: runtime.audios,
    },
    params: {
      ...runtime.modelParamValues,
      ...runtime.injectedValues,
    },
    data: semanticData,
  }
}
