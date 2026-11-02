import {
  createDefaultProviderReasoning,
} from '@/core/llm/defaults'
import type {
  LlmApiProtocol,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
} from '@henjicc/ai-sdk'
import { createModelFromInput } from '@/services/llm/llmDiscoveryService'

/* 自定义端点可直接选协议；预制供应商默认由 SDK 按模型选择，也允许用户显式覆盖。 */
export const providerProtocolOptions: Array<{ value: LlmApiProtocol; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
]

export function createDefaultProvider(): LlmProviderConfig {
  const adapter = 'openai'
  return {
    providerId: '',
    setup: { kind: 'custom' },
    displayName: '',
    adapter,
    apiProtocol: 'openai-compatible',
    baseUrl: '',
    reasoning: createDefaultProviderReasoning(adapter),
    enabled: true,
  }
}

export function createEmptyModel(provider: LlmProviderConfig): LlmModelConfig {
  return createModelFromInput(provider, '', '', {})
}

export function resolveProviderReasoning(provider: LlmProviderConfig): LlmReasoningConfig {
  return provider.reasoning ?? createDefaultProviderReasoning(provider.adapter)
}

function toProviderSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
}

export function createProviderId(name: string, providers: LlmProviderConfig[]): string {
  const baseId = toProviderSlug(name) || 'provider'
  const usedIds = new Set(providers.map(provider => provider.providerId))
  if (!usedIds.has(baseId)) return baseId
  let index = 2
  while (usedIds.has(`${baseId}-${index}`)) {
    index += 1
  }
  return `${baseId}-${index}`
}

export function resolveApiPreview(provider: LlmProviderConfig): string {
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) return ''
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (/\/(?:responses|chat\/completions)$/.test(normalized)) return normalized
  if (provider.apiProtocol === 'openai-responses') return `${normalized}/responses`
  return /\/v\d+$/.test(normalized)
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

