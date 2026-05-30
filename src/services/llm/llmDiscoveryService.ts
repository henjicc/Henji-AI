import { createLogger } from '@/core/logging'
import { fetch } from '@tauri-apps/plugin-http'
import type { LlmCapabilities, LlmModelConfig, LlmProviderConfig } from '@/core/llm/types'

const logger = createLogger('services.llm.llmDiscoveryService')

export interface DiscoveredModelItem {
  modelId: string
  displayName: string
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string; title?: string; name?: string }>
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = trimSlash(baseUrl)
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`
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
  provider: LlmProviderConfig,
  apiKey?: string
): Promise<DiscoveredModelItem[]> {
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) {
    throw new Error('请先配置 API 地址')
  }

  const url = resolveModelsEndpoint(baseUrl)
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }

  try {
    const response = await fetch(url, { method: 'GET', headers })
    if (!response.ok) {
      throw new Error(`获取模型列表失败: ${response.status}`)
    }
    const data = await response.json() as OpenAiModelsResponse
    const discovered = (data.data ?? [])
      .map(item => {
        const modelId = item.id?.trim()
        if (!modelId) return null
        const displayName = item.title?.trim() || item.name?.trim() || modelId
        return {
          modelId,
          displayName,
        }
      })
      .filter((item): item is DiscoveredModelItem => item !== null)
    return discovered
  } catch (error) {
    logger.error('[llmDiscoveryService] fetchOpenAiCompatibleModels failed', error)
    throw error
  }
}
