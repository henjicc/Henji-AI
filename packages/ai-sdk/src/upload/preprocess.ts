import type { RuntimeContext } from '../runtime/RuntimeContext'
import type { RuntimeConstraints } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'
import { strategy as apimart } from './provider-preprocessors/apimart'
import { strategy as dataUri } from './provider-preprocessors/data-uri'
import { strategy as fal } from './provider-preprocessors/fal'
import { preprocessProviderInput } from './provider-preprocessors/factory'
import { strategy as kie } from './provider-preprocessors/kie'
import { strategy as ppio } from './provider-preprocessors/ppio'

const preprocessors = { apimart, fal, kie, modelscope: kie, ppio } as const

/**
 * 默认全量入口的兼容组合层。真正的媒体遍历只有 `preprocess-core` 一份；按需 packs 则直接
 * 注入对应 provider-scoped 策略，不会静态带入其他供应商。
 */
export async function preprocessRequestBody(
  providerId: string,
  route: string,
  body: JsonValue,
  runtime: RuntimeContext,
  params: JsonObject = {},
  constraints?: RuntimeConstraints,
  requestId?: string,
  signal?: AbortSignal
): Promise<JsonValue> {
  const strategy = preprocessors[providerId as keyof typeof preprocessors] ?? dataUri
  return await preprocessProviderInput(strategy, {
    providerId,
    route,
    body,
    runtime,
    params,
    constraints,
    requestId: requestId ?? `${providerId}-preprocess`,
    signal: signal ?? new AbortController().signal,
  })
}
