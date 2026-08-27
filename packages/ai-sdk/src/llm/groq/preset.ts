import type { LlmProviderPreset } from '../providerPresets'
import type { LlmModelConfig } from '../types'

export const GROQ_PROVIDER_ID = 'groq'
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const GROQ_DEFAULT_MODEL_ID = 'openai/gpt-oss-20b'

/** GroqCloud 预设；供应商与 xAI Grok 没有关系。 */
export const GROQ_PROVIDER_PRESET: LlmProviderPreset = {
  providerId: GROQ_PROVIDER_ID,
  displayName: 'GroqCloud',
  adapter: 'openai',
  apiProtocol: 'openai-compatible',
  baseUrl: GROQ_BASE_URL,
  reasoning: { enabled: true, effort: 'medium' },
  reasoningConfigurable: true,
  modelIds: [GROQ_DEFAULT_MODEL_ID],
  apiKeyUrl: 'https://console.groq.com/keys',
  docs: 'docs/model-adaptation/供应商/Groq.md',
  note: 'GroqCloud（providerId=groq）不是 xAI Grok；GPT-OSS 不支持 reasoning_format。',
}

/** 可直接交给统一能力发现器的默认模型；不会触发模型列表网络请求。 */
export const GROQ_DEFAULT_MODEL_CONFIG: LlmModelConfig = {
  providerId: GROQ_PROVIDER_ID,
  modelId: GROQ_DEFAULT_MODEL_ID,
  displayName: 'GPT-OSS 20B',
  adapter: 'openai',
  apiProtocol: 'openai-compatible',
  baseUrl: GROQ_BASE_URL,
  catalogId: 'gpt-oss-20b',
  capabilities: {
    text: true,
    image: false,
    video: false,
    audio: false,
    streaming: true,
    toolCall: true,
    parallelTools: false,
    jsonOutput: true,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    usage: true,
  },
  enabled: true,
}
