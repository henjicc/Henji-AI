import type { LlmStreamEventDto } from '../chatTypes'
import type { LlmModule, LlmModuleDescriptor } from '../modules/types'
import { runLlmChatStream } from '../chat'
import { discoverModels } from '../discovery'
import {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL_CONFIG,
  GROQ_DEFAULT_MODEL_ID,
  GROQ_PROVIDER_ID,
} from './preset'

export const GROQ_LLM_MODULE_ID = 'groq.chat.openai/gpt-oss-20b'

/** Groq 内置路由的正式 module descriptor；外部插件占用同坐标时由 LlmModuleClient 拒绝。 */
export const GROQ_LLM_MODULE_DESCRIPTOR: LlmModuleDescriptor = Object.freeze({
  id: GROQ_LLM_MODULE_ID,
  source: Object.freeze({ kind: 'builtin', namespace: '@henjicc/ai-sdk' }),
  providerId: GROQ_PROVIDER_ID,
  modelId: GROQ_DEFAULT_MODEL_ID,
  displayName: GROQ_DEFAULT_MODEL_CONFIG.displayName,
  capabilities: Object.freeze({ ...GROQ_DEFAULT_MODEL_CONFIG.capabilities }),
  executionModes: Object.freeze(['request-response', 'event-stream'] as const),
  tags: Object.freeze(['groq', 'openai-compatible', 'builtin']),
})

/** 把现有 Groq Chat/SSE/发现内核包装成同一 LLM module，不复制协议实现。 */
export function createGroqLlmModule(): LlmModule {
  return {
    descriptor: GROQ_LLM_MODULE_DESCRIPTOR,
    execute: async (request, context) => {
      let pendingEvent = Promise.resolve()
      const forward = (event: LlmStreamEventDto): void => {
        if (context.mode !== 'event-stream') return
        if (event.type !== 'Token' && event.type !== 'ReasoningToken') return
        pendingEvent = pendingEvent.then(async () => await context.emit(event))
      }
      const outcome = await runLlmChatStream({
        ...request,
        providerId: GROQ_PROVIDER_ID,
        modelId: request.modelId || GROQ_DEFAULT_MODEL_ID,
        adapter: 'openai',
        baseUrl: request.baseUrl?.trim() || GROQ_BASE_URL,
      }, context.requestId, forward, context.runtime, {}, { signal: context.signal })
      await pendingEvent
      return {
        output: outcome.output,
        reasoningOutput: outcome.reasoningOutput,
        usage: outcome.usage,
        finishReason: outcome.finishReason,
      }
    },
    discover: async (context) => await discoverModels(GROQ_PROVIDER_ID, GROQ_BASE_URL, context.runtime, {
      signal: context.signal,
      requireCredential: true,
      activeOnly: true,
    }),
  }
}
