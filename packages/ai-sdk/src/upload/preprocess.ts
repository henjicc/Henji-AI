import type { RuntimeContext } from '../runtime/RuntimeContext'
import type { RuntimeConstraints } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'
import { strategy as apimart } from './provider-preprocessors/apimart'
import { strategy as bailian } from './provider-preprocessors/bailian'
import { strategy as dataUri } from './provider-preprocessors/data-uri'
import { strategy as fal } from './provider-preprocessors/fal'
import { preprocessProviderInput } from './provider-preprocessors/factory'
import { strategy as kie } from './provider-preprocessors/kie'
import { strategy as ppio } from './provider-preprocessors/ppio'
import { strategy as publicHost } from './provider-preprocessors/public-host'
import { strategy as volcengine } from './provider-preprocessors/volcengine'

const preprocessors = { apimart, bailian, fal, kie, modelscope: publicHost, ppio, volcengine } as const
/**
 * 大语言模型对话的消息里，百炼、火山方舟的视频与音频直接收 Data URI；生成用的托管策略
 * （百炼临时存储按生成模型签发凭证、方舟参考视频托管）不适用于对话接口。
 */
const llmPreprocessors = { apimart, fal, kie, modelscope: kie, ppio } as const

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
  signal?: AbortSignal,
  purpose: 'generation' | 'llm' = 'generation'
): Promise<JsonValue> {
  const table = purpose === 'llm' ? llmPreprocessors : preprocessors
  const strategy = table[providerId as keyof typeof table] ?? dataUri
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
