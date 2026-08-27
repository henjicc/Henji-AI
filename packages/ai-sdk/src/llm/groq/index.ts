import type { RuntimeContext } from '../../runtime/RuntimeContext'
import {
  runLlmChatStream,
  type LlmChatExecutionOptions,
  type LlmChatStreamHooks,
  type LlmChatStreamOutcome,
} from '../chat'
import type { LlmChatRequestDto, LlmStreamEmitter } from '../chatTypes'
import {
  discoverModels,
  type DiscoveredModelItem,
  type DiscoverModelsOptions,
} from '../discovery'
import {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL_ID,
  GROQ_PROVIDER_ID,
  GROQ_PROVIDER_PRESET,
} from './preset'

export {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL_ID,
  GROQ_PROVIDER_ID,
  GROQ_PROVIDER_PRESET,
} from './preset'

export type GroqChatRequest = Omit<
  LlmChatRequestDto,
  'providerId' | 'modelId' | 'adapter' | 'baseUrl'
> & {
  /** 缺省使用 Say-It 已确认的 openai/gpt-oss-20b。 */
  modelId?: string
  /** 默认使用 GroqCloud 官方地址；仅为代理或测试宿主保留显式覆盖。 */
  baseUrl?: string
}

export interface GroqChatStreamOptions extends LlmChatExecutionOptions {
  hooks?: LlmChatStreamHooks
}

export type GroqDiscoveryOptions = Omit<
  DiscoverModelsOptions,
  'requireCredential' | 'activeOnly'
>

/**
 * 把 Groq 的稳定坐标补到通用 LLM DTO；真正的 SSE、错误、usage 与 finish 解析仍由共享内核完成。
 */
export function createGroqChatRequest(request: GroqChatRequest): LlmChatRequestDto {
  return {
    ...request,
    providerId: GROQ_PROVIDER_ID,
    modelId: request.modelId?.trim() || GROQ_DEFAULT_MODEL_ID,
    adapter: 'openai',
    baseUrl: request.baseUrl?.trim() || GROQ_BASE_URL,
  }
}

/** Groq 按需流式入口；没有复制第二套 OpenAI-compatible 执行逻辑。 */
export async function runGroqChatStream(
  request: GroqChatRequest,
  taskId: string,
  emit: LlmStreamEmitter,
  runtime: RuntimeContext,
  options: GroqChatStreamOptions = {}
): Promise<LlmChatStreamOutcome> {
  const { hooks = {}, signal, timeoutMs } = options
  return await runLlmChatStream(
    createGroqChatRequest(request),
    taskId,
    emit,
    runtime,
    hooks,
    { signal, timeoutMs }
  )
}

/** Groq 官方 /models 发现：要求凭据并过滤 active=false，保留未知 active 的兼容项。 */
export async function discoverGroqModels(
  runtime: RuntimeContext,
  options: GroqDiscoveryOptions = {}
): Promise<DiscoveredModelItem[]> {
  return await discoverModels(GROQ_PROVIDER_ID, GROQ_BASE_URL, runtime, {
    ...options,
    requireCredential: true,
    activeOnly: true,
  })
}

export type {
  DiscoveredModelItem,
  LlmChatExecutionOptions,
  LlmChatStreamHooks,
  LlmChatStreamOutcome,
  LlmStreamEmitter,
  RuntimeContext,
}
