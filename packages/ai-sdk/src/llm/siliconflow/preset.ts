import type { LlmProviderPreset } from '../providerPresets'
import { findProviderMetadata } from '../../providers/metadata'
import { tokenListPrice, tokenPrice } from '../../pricing/tokenPricing'

export const SILICONFLOW_PROVIDER_ID = 'siliconflow'
export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1'
export const SILICONFLOW_DEFAULT_MODEL_ID = 'deepseek-ai/DeepSeek-V4-Flash'

const SILICONFLOW_PEAK_HOURS = '北京时间 00:00–02:00、08:00–24:00'

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
  // 不继承原厂；平台没有单独的输出上限（max_tokens 只受上下文窗口约束），留空。视频输入未取得托管接口的字段契约，一律不声明。
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
  // 控制台模型详情“在线推理”价（单元格按千 tokens 标，这里换算成百万）；DeepSeek Flash 系列每天 02:00–08:00 为闲时价。
  modelPricing: {
    [SILICONFLOW_DEFAULT_MODEL_ID]: { ...tokenListPrice('CNY', 3, 9, 0.3), offPeak: { ...tokenPrice(1.5, 4.5, 0.15), peakHours: SILICONFLOW_PEAK_HOURS } },
    'deepseek-ai/DeepSeek-V4.1-Flash': { ...tokenListPrice('CNY', 2, 8, 0.04), offPeak: { ...tokenPrice(1, 4, 0.02), peakHours: SILICONFLOW_PEAK_HOURS } },
    'deepseek-ai/DeepSeek-V4-Pro': tokenListPrice('CNY', 12, 24, 1),
    'zai-org/GLM-5.3': tokenListPrice('CNY', 8, 28, 2),
    'zai-org/GLM-5.3-Flash': tokenListPrice('CNY', 0.8, 2.8, 0.23),
    'zai-org/GLM-5.2': tokenListPrice('CNY', 8, 28, 2),
    'moonshotai/Kimi-K2.7-Code': tokenListPrice('CNY', 6.5, 27, 1.3),
    'Qwen/Qwen3.8-27B': tokenListPrice('CNY', 3, 12),
  },
  websiteUrl: metadata.websiteUrl,
  apiKeyUrl: metadata.apiKeyUrl,
  docs: 'docs/model-adaptation/供应商/硅基流动.md',
  note: '预设只列常用模型；通过模型发现获取账号可用清单。这里的 DeepSeek V4 Flash 与 DeepSeek 官方 V4.1 Flash 是不同模型。',
}
