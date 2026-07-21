import { createLogger } from '@/core/logging'
import type { LlmCapabilities, LlmModelConfig, LlmProviderConfig } from '@/core/llm/types'

const logger = createLogger('services.llm.llmDiscoveryService')

export interface DiscoveredModelItem {
  modelId: string
  displayName: string
}

function getDefaultCapabilities(): LlmCapabilities {
  return {
    text: true,
    image: false,
    video: false,
    audio: false,
    streaming: true,
    toolCall: false,
    jsonOutput: false,
  }
}

export function createModelFromInput(
  provider: LlmProviderConfig,
  modelId: string,
  displayName?: string,
  capabilities?: Partial<LlmCapabilities>
): LlmModelConfig {
  return {
    providerId: provider.providerId,
    modelId: modelId.trim(),
    displayName: displayName?.trim() || modelId.trim(),
    adapter: provider.adapter,
    baseUrl: provider.baseUrl,
    capabilities: {
      ...getDefaultCapabilities(),
      ...capabilities,
      text: true,
    },
    enabled: true,
  }
}

export async function fetchOpenAiCompatibleModels(
  provider: LlmProviderConfig
): Promise<DiscoveredModelItem[]> {
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) {
    throw new Error('请先配置 API 地址')
  }

  try {
    return await window.henjiNative!.llm.discoverModels(provider.providerId, baseUrl)
  } catch (error) {
    logger.error('[llmDiscoveryService] fetchOpenAiCompatibleModels failed', error)
    throw error
  }
}
