/**
 * 续接生成的公共读写：完成时按模型声明取出续接引用，续接请求时读出 `__continuation`。
 * 引用是平台内部标识（任务 ID、草稿缓存地址），只在请求构建里使用，不进入界面。
 */

import { CONTINUATION_PARAM, type ModelRuntimeDefinition, type RuntimeContinuation, type RuntimeContinuationParam } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 完成结果能做的续接：动作标识 → 平台引用。没有可续接的动作时返回 undefined。 */
export function captureContinuations(
  model: Pick<ModelRuntimeDefinition, 'continuations'>,
  params: JsonObject,
  result: { taskId?: string; metadata: JsonValue },
): Record<string, JsonObject> | undefined {
  const captured: Record<string, JsonObject> = {}
  for (const continuation of model.continuations ?? []) {
    if (continuation.available && !continuation.available(params)) continue
    const reference = continuation.capture(result)
    if (reference) captured[continuation.id] = reference
  }
  return Object.keys(captured).length > 0 ? captured : undefined
}

/** 找到源模型上的某个续接动作。 */
export function findContinuation(
  model: Pick<ModelRuntimeDefinition, 'continuations'> | undefined,
  id: string,
): RuntimeContinuation | undefined {
  return model?.continuations?.find(continuation => continuation.id === id)
}

/**
 * 续接请求的完整参数：源参数经动作调整，再带上续接引用。
 * 源参数里上一次续接的引用不再沿用，避免把多步续接混成一次。
 */
export function buildContinuationParams(
  sourceModelId: string,
  continuation: RuntimeContinuation,
  source: JsonObject,
  reference: JsonObject,
): JsonObject {
  const { [CONTINUATION_PARAM]: _previous, ...rest } = source
  return { ...continuation.params(rest), [CONTINUATION_PARAM]: { id: continuation.id, sourceModelId, reference } }
}

/** 读出请求参数里的续接引用；指定动作时只认这个动作。 */
export function readContinuation(params: JsonObject, id?: string): RuntimeContinuationParam | null {
  const value = params[CONTINUATION_PARAM]
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.sourceModelId !== 'string' || !isObject(value.reference)) return null
  if (id && value.id !== id) return null
  return { id: value.id, sourceModelId: value.sourceModelId, reference: value.reference }
}
