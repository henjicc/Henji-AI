import type { LlmProviderPreset } from '../providerPresets'

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
