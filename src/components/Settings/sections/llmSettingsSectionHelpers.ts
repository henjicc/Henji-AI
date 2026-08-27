import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_PPIO_PROVIDER_ID,
  createDefaultProviderReasoning,
} from '@/core/llm/defaults'
import type {
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  LlmReasoningEffort,
} from '@henjicc/ai-sdk'
import { createModelFromInput } from '@/services/llm/llmDiscoveryService'

/*
 * 适配器类型只保留真实接通的两种。
 *
 * 原来还有一个 `anthropic` 选项，但运行时从来没有对应实现——`provider.ts` 只注册了
 * `openai-compatible` 协议，选了它发出去的仍然是 Chat Completions 形状的请求，唯一的区别是
 * 设置页预览文案会骗人地显示成 `/v1/messages`。存量配置由 LlmConfigService 归一化成 openai。
 * Anthropic Messages 协议按 packages/ai-sdk/docs/llm-adaptation/README.md 第三节属于最低优先级，等真正接上再加回来。
 */
export const providerTypes = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI 兼容' },
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
    displayName: '',
    adapter,
    baseUrl: '',
    reasoning: createDefaultProviderReasoning(adapter),
    enabled: true,
  }
}

export function getDefaultBaseUrlForAdapter(adapter: string): string {
  return adapter === 'deepseek' ? DEFAULT_DEEPSEEK_BASE_URL : ''
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
  return normalized.endsWith('/v1') ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`
}

export function getApiKeyHint(provider: LlmProviderConfig): string | undefined {
  if (provider.providerId !== DEFAULT_PPIO_PROVIDER_ID) return undefined
  return '留空时会自动复用主生成设置里已配置的派欧云 API Key，单独填写后优先使用这里的值。'
}
