import {
  buildContinuationParams,
  captureContinuations,
  findContinuation,
  type JsonObject,
  type JsonValue,
} from '@henjicc/ai-sdk'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

/** 素材参数：续接靠平台引用，不重新上传源结果的素材。 */
const MEDIA_KEYS = new Set(['images', 'uploadedImages', 'uploadedFilePaths', 'videos', 'uploadedVideos', 'uploadedVideoFilePaths', 'video', 'audios', 'uploadedAudios', 'uploadedAudioFilePaths'])

/** 续接引用随结果存在任务参数里的键名；只给续接请求用，界面不展示。 */
export const GENERATION_CONTINUATIONS_KEY = '__continuations'

export interface AvailableGenerationContinuation {
  /** 续接动作标识，如 finalize-draft、extend、animate */
  id: string
  targetModelId: string
  submit: 'direct' | 'edit'
}

export interface PreparedGenerationContinuation extends AvailableGenerationContinuation {
  /** 续接请求的完整参数，已带上续接引用 */
  params: DynamicValueMap
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 完成时按模型声明取出续接引用（草稿缓存、平台任务号），随结果保存，之后续接时交回模型。 */
export function captureResultContinuations(
  model: Pick<ModelDefinition, 'continuations'> | undefined,
  params: DynamicValueMap,
  taskId: string | undefined,
  metadata: unknown,
): Record<string, JsonObject> | undefined {
  if (!model?.continuations?.length) return undefined
  return captureContinuations(model, params as JsonObject, { taskId, metadata: (metadata ?? null) as JsonValue })
}

/**
 * 把这一次结果的续接引用写进要保存的任务参数。参数可能来自重新编辑或再次生成，带着上一次结果的引用，
 * 所以总是按这一次结果重写：没有可续接的动作时删掉旧引用，避免出现指向旧草稿的按钮。
 */
export function withStoredContinuations(options: DynamicValueMap, continuations: Record<string, JsonObject> | undefined): DynamicValueMap {
  const { [GENERATION_CONTINUATIONS_KEY]: _previous, ...rest } = options
  return continuations ? { ...rest, [GENERATION_CONTINUATIONS_KEY]: continuations as unknown as DynamicValue } : rest
}

function storedReferences(options: DynamicValueMap | undefined): Record<string, JsonObject> {
  const stored = options?.[GENERATION_CONTINUATIONS_KEY]
  if (!isObject(stored)) return {}
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, JsonObject] => isObject(entry[1])))
}

/** 这次结果现在能做的续接；源模型或目标模型已不可用时不列出。 */
export function listGenerationContinuations(sourceModelId: string, options: DynamicValueMap | undefined): AvailableGenerationContinuation[] {
  const model = registry.getModel(sourceModelId)
  const references = storedReferences(options)
  return (model?.continuations ?? []).flatMap((continuation) => {
    if (!references[continuation.id]) return []
    if (continuation.available && !continuation.available((options ?? {}) as JsonObject)) return []
    const targetModelId = continuation.targetModelId ?? sourceModelId
    if (!registry.getModel(targetModelId)) return []
    return [{ id: continuation.id, targetModelId, submit: continuation.submit }]
  })
}

/** 生成续接请求：源参数按动作调整并带上保存的引用。结果不能做这个续接时返回 null。 */
export function prepareGenerationContinuation(
  sourceModelId: string,
  options: DynamicValueMap | undefined,
  continuationId: string,
): PreparedGenerationContinuation | null {
  const continuation = findContinuation(registry.getModel(sourceModelId), continuationId)
  const reference = storedReferences(options)[continuationId]
  if (!continuation || !reference) return null
  const targetModelId = continuation.targetModelId ?? sourceModelId
  if (!registry.getModel(targetModelId)) return null
  // `__` 开头的是宿主为那一次请求补的派生值（续接引用、视频时长、结果地址），只属于源结果；
  // 素材也不带：续接靠平台引用，重新上传既多余，又会撞上目标模型的素材数量限制。
  const source = Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => !key.startsWith('__') && !MEDIA_KEYS.has(key)))
  const params = buildContinuationParams(sourceModelId, continuation, source as JsonObject, reference) as DynamicValueMap
  return { id: continuation.id, targetModelId, submit: continuation.submit, params }
}
