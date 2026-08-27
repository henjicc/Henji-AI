import {
  createGenerationClient,
  type CreateGenerationClientConfig,
  type GenerationClient,
  type GenerationClientCancelRequest,
  type GenerationClientCatalog,
  type GenerationClientCompletedInfo,
  type GenerationClientContinuePollingRequest,
  type GenerationClientHooks,
  type GenerationClientProviderRegistration,
  type GenerationClientProviders,
  type GenerationClientRequestInfo,
  type GenerationClientResult,
} from './generation'
import {
  resolveLlmTaskId,
  runLlmChatStream,
  type LlmChatStreamHooks,
  type LlmChatStreamOutcome,
} from './llm/chat'
import type { LlmChatRequestDto, LlmStreamEmitter } from './llm/chatTypes'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from './llm/modelStep'
import { runModelStep } from './llm/sdk/runtime'
import { resolveRuntimeContext } from './runtime'

export type AIClientProviderRegistration = GenerationClientProviderRegistration
export type CreateAIClientConfig = CreateGenerationClientConfig
export type AIClientGenerateResult = GenerationClientResult
export type AIClientGenerationRequestInfo = GenerationClientRequestInfo
export type AIClientGenerationCompletedInfo = GenerationClientCompletedInfo
export type AIClientGenerationHooks = GenerationClientHooks
export type AIClientContinuePollingRequest = GenerationClientContinuePollingRequest
export type AIClientCancelRequest = GenerationClientCancelRequest
export type AIClientCatalog = GenerationClientCatalog
export type AIClientProviders = GenerationClientProviders

export interface AIClientChat {
  stream(
    request: LlmChatRequestDto,
    emit: LlmStreamEmitter,
    hooks?: LlmChatStreamHooks
  ): Promise<LlmChatStreamOutcome>
  modelStep(
    input: ModelStepInput,
    emit: (event: ModelStepEvent) => void
  ): Promise<ModelStepResult>
}

export interface AIClient extends GenerationClient {
  chat: AIClientChat
}

/**
 * 创建共享一个 RuntimeContext 的完整 SDK 客户端。生成能力直接组合
 * {@link createGenerationClient} 的唯一内核；根入口只追加 LLM 能力。
 */
export function createAIClient(config: CreateAIClientConfig): AIClient {
  const generation = createGenerationClient(config)
  const runtime = resolveRuntimeContext(config.runtime)

  const ensureActive = (): void => {
    // 复用生成内核的 disposal 守卫，不维护第二份生命周期状态。
    generation.catalog.list()
  }

  return {
    ...generation,
    chat: {
      async stream(request, emit, hooks = {}) {
        ensureActive()
        const taskId = resolveLlmTaskId(request)
        return await runLlmChatStream(request, taskId, emit, runtime, hooks)
      },
      async modelStep(input, emit) {
        ensureActive()
        return await runModelStep(input, emit, runtime)
      },
    },
  }
}
