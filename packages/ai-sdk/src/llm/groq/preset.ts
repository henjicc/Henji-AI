import type { LlmProviderPreset } from '../providerPresets'
import type { LlmModelConfig } from '../types'
import { findProviderMetadata } from '../../providers/metadata'

export const GROQ_PROVIDER_ID = 'groq'
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const GROQ_DEFAULT_MODEL_ID = 'openai/gpt-oss-20b'

const GROQ_PROVIDER_METADATA = findProviderMetadata(GROQ_PROVIDER_ID)
if (!GROQ_PROVIDER_METADATA) throw new Error('[provider_metadata_missing] provider "groq" is not registered')

/** GroqCloud 预设；供应商与 xAI Grok 没有关系。 */
export const GROQ_PROVIDER_PRESET: LlmProviderPreset = {
  providerId: GROQ_PROVIDER_ID,
  displayName: 'GroqCloud',
  adapter: 'openai',
  apiProtocol: 'openai-compatible',
  baseUrl: GROQ_BASE_URL,
  reasoning: { enabled: true, effort: 'medium' },
  reasoningConfigurable: true,
  // 2026-11-07 按官方模型页核对：自助账号可用的对话模型只有 GPT-OSS 两款正式版与 Qwen3.8-27B 预览版；
  // Llama 系列为企业版，Prompt Guard / Safeguard 是安全分类器，Orpheus 是语音合成，均不进对话预设。
  modelIds: [GROQ_DEFAULT_MODEL_ID, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
  // 托管限制以 Groq 模型页为准：Qwen3.8-27B 上下文 131,072、最大输出 16,384、每次最多 3 张图，支持 JSON Schema。
  modelCapabilities: {
    'qwen/qwen3.8-27b': {
      image: true, video: false, audio: false, file: false,
      toolCall: true, jsonOutput: true, structuredOutputMode: 'schema', reasoning: true,
      contextWindow: 131_072, maxOutputTokens: 16_384,
    },
  },
  websiteUrl: GROQ_PROVIDER_METADATA.websiteUrl,
  apiKeyUrl: GROQ_PROVIDER_METADATA.apiKeyUrl,
  docs: 'docs/model-adaptation/供应商/Groq.md',
  note: 'GroqCloud（providerId=groq）不是 xAI Grok；GPT-OSS 不支持 reasoning_format；Qwen3.8-27B 为预览模型，可能随时下线。',
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
    file: false,
    streaming: true,
    toolCall: true,
    parallelTools: false,
    jsonOutput: true,
    structuredOutputMode: 'json',
    structuredOutputWithReasoning: true,
    reasoning: true,
    sampling: true,
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    usage: true,
  },
  enabled: true,
}
