import type { LlmProviderPreset } from '../providerPresets'
import { findProviderMetadata } from '../../providers/metadata'

export const SILICONFLOW_PROVIDER_ID = 'siliconflow'
export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1'
export const SILICONFLOW_DEFAULT_MODEL_ID = 'deepseek-ai/DeepSeek-V4-Flash'

const metadata = findProviderMetadata(SILICONFLOW_PROVIDER_ID)
if (!metadata) throw new Error('[provider_metadata_missing] siliconflow')

/** 国内托管能力以硅基流动为准，不继承原厂专属协议与未确认的输出上限。 */
export const SILICONFLOW_PROVIDER_PRESET: LlmProviderPreset = {
  providerId: SILICONFLOW_PROVIDER_ID,
  displayName: '硅基流动',
  adapter: 'openai',
  apiProtocol: 'openai-compatible',
  baseUrl: SILICONFLOW_BASE_URL,
  reasoning: { enabled: true, effort: 'high' },
  reasoningConfigurable: true,
  // 2026-11-07 按账号模型列表核对；已过时的条目在建模型时自动跳过。
  modelIds: [
    SILICONFLOW_DEFAULT_MODEL_ID,
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'deepseek-ai/DeepSeek-V4-Pro',
    'zai-org/GLM-5.3',
    'zai-org/GLM-5.3-Flash',
    'zai-org/GLM-5.2',
    'moonshotai/Kimi-K2.7-Code',
    'Qwen/Qwen3.8-27B',
  ],
  // 托管能力以硅基流动为准（模型广场的结构化字段：vlm、functionCallSupport、jsonModeSupport、contextLen），
  // 不继承原厂；平台没给输出上限，留空由动态验证补齐。视频输入未取得托管接口的字段契约，一律不声明。
  modelCapabilities: {
    'zai-org/GLM-5.3': {
      image: false, video: false, audio: false, file: false,
      sampling: true, contextWindow: 1_048_576, maxOutputTokens: null,
    },
    ...Object.fromEntries(([
      ['deepseek-ai/DeepSeek-V4.1-Flash', true],
      ['deepseek-ai/DeepSeek-V4-Pro', false],
      ['zai-org/GLM-5.3-Flash', true],
      ['zai-org/GLM-5.2', false],
    ] as const).map(([modelId, image]) => [modelId, {
      image, video: false, audio: false, file: false,
      toolCall: true, jsonOutput: true, structuredOutputMode: 'json' as const, reasoning: true,
      contextWindow: 1_048_576, maxOutputTokens: null,
    }])),
  },
  websiteUrl: metadata.websiteUrl,
  apiKeyUrl: metadata.apiKeyUrl,
  docs: 'docs/model-adaptation/供应商/硅基流动.md',
  note: '预设只列常用模型；通过模型发现获取账号可用清单。这里的 DeepSeek V4 Flash 与 DeepSeek 官方 V4.1 Flash 是不同模型。',
}
