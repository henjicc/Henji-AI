import { createLogger } from '@/core/logging'
import type { LlmCapabilities, LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import { createLlmCapabilitiesForModel } from '@/core/llm/defaults'
import { findLlmModelCatalogEntry } from '@henjicc/ai-sdk'

const logger = createLogger('services.llm.llmDiscoveryService')

export interface DiscoveredModelItem {
  modelId: string
  displayName: string
  contextWindow: number | null
  maxOutputTokens: number | null
}

/**
 * 合并调用方额外提供的能力。
 *
 * 探测接口返回的上下文/输出上限经常是 null（很多网关根本不返回这两个字段），
 * 直接展开会把内置目录里查到的准确值冲掉，所以 null 一律当作"没提供"。
 */
function mergeCapabilities(
  base: LlmCapabilities,
  extra: Partial<LlmCapabilities> | undefined
): LlmCapabilities {
  if (!extra) return base
  const merged = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue
    Object.assign(merged, { [key]: value })
  }
  return merged
}

export function createModelFromInput(
  provider: LlmProviderConfig,
  modelId: string,
  displayName?: string,
  capabilities?: Partial<LlmCapabilities>
): LlmModelConfig {
  const trimmedModelId = modelId.trim()
  const entry = findLlmModelCatalogEntry(trimmedModelId)
  return {
    providerId: provider.providerId,
    modelId: trimmedModelId,
    displayName: displayName?.trim() || trimmedModelId,
    adapter: provider.adapter,
    baseUrl: provider.baseUrl,
    // 命中内置目录时直接按官方文档标好输入模态、工具调用、上下文等能力，用户不用自己勾。
    capabilities: {
      ...mergeCapabilities(createLlmCapabilitiesForModel(trimmedModelId), capabilities),
      text: true,
    },
    catalogId: entry?.id,
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
