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
  modelIds: [
    SILICONFLOW_DEFAULT_MODEL_ID,
    'zai-org/GLM-5.3',
    'moonshotai/Kimi-K2.7-Code',
    'Qwen/Qwen3.8-27B',
  ],
  modelCapabilities: {
    'zai-org/GLM-5.3': {
      image: false, video: false, audio: false, file: false,
      sampling: true, contextWindow: 1_048_576, maxOutputTokens: null,
    },
  },
  websiteUrl: metadata.websiteUrl,
  apiKeyUrl: metadata.apiKeyUrl,
  docs: 'docs/model-adaptation/供应商/硅基流动.md',
  note: '预设只列常用模型；通过模型发现获取账号可用清单。这里的 DeepSeek V4 Flash 与 DeepSeek 官方 V4.1 Flash 是不同模型。',
}
