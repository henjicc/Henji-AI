import { createLogger } from '@/core/logging'
import type { LlmChatRequest, LlmStreamEvent } from '@/core/llm/types'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

const logger = createLogger('commands.llmRuntime')

export interface LlmProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

function ensureDesktopRuntime(): void {
  if (!isDesktopRuntime()) {
    throw new Error('LLM Runtime only available in desktop mode')
  }
}

export async function llmSetProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().llmRuntime.setProviderApiKey(providerId, apiKey)
}

export async function llmRemoveProviderApiKey(providerId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().llmRuntime.removeProviderApiKey(providerId)
}

export async function llmGetProviderApiKey(providerId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.getProviderApiKey(providerId)
}

export async function llmGetProviderKeyStatus(providerIds: string[]): Promise<LlmProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.getProviderKeyStatus(providerIds)
}

export async function llmChatStream(
  request: LlmChatRequest,
  onEvent: (event: LlmStreamEvent) => void
): Promise<void> {
  ensureDesktopRuntime()
  const handleEvent = (event: LlmStreamEvent): void => {
    if (event.type === 'Error') {
      logger.error('[LlmRuntimeCmd] LLM 请求失败', event.data, {
        event: 'llm_runtime.chat_stream.failed',
        requestId: request.requestId,
        providerId: request.providerId,
        modelId: request.modelId,
        context: {
          request,
          streamError: event.data,
        },
      })
    }
    onEvent(event)
  }
  try {
    await getPlatform().llmRuntime.chatStream(request, handleEvent)
  } catch (error) {
    logger.error('[LlmRuntimeCmd] LLM 请求调用失败', error, {
      event: 'llm_runtime.chat_stream.invoke_failed',
      requestId: request.requestId,
      providerId: request.providerId,
      modelId: request.modelId,
      context: {
        request,
      },
    })
    throw error
  }
}

export async function llmCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().llmRuntime.cancelTask(taskId)
}
