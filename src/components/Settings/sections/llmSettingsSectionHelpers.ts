import {
  DEFAULT_PPIO_PROVIDER_ID,
  createDefaultProviderReasoning,
} from '@/core/llm/defaults'
import type {
  LlmApiProtocol,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  LlmReasoningEffort,
} from '@henjicc/ai-sdk'
import { createModelFromInput } from '@/services/llm/llmDiscoveryService'

/* 自定义未知端点只暴露真实接通的协议；预制供应商由 SDK 按模型选择，不使用这里的选项。 */
export const providerProtocolOptions: Array<{ value: LlmApiProtocol; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
]

export const reasoningEffortOptions: Array<{ value: LlmReasoningEffort; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: '最高' },
]

export type ReasoningModeValue = 'off' | LlmReasoningEffort

export const reasoningModeOptions: Array<{ value: ReasoningModeValue; label: string }> = [
  { value: 'off', label: '关闭' },
  ...reasoningEffortOptions,
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

export function getReasoningModeLabel(value: ReasoningModeValue): string {
  if (value === 'off') return '关闭'
  return reasoningEffortOptions.find(option => option.value === value)?.label ?? '高'
}

export function resolveReasoningMode(provider: LlmProviderConfig): ReasoningModeValue {
  const reasoning = resolveProviderReasoning(provider)
  return reasoning.enabled ? reasoning.effort : 'off'
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

export function getApiKeyHint(provider: LlmProviderConfig): string | undefined {
  if (provider.providerId !== DEFAULT_PPIO_PROVIDER_ID) return undefined
  return '留空时会自动复用主生成设置里已配置的派欧云 API Key，单独填写后优先使用这里的值。'
}
