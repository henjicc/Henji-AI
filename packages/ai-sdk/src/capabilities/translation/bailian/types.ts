import { tokenListPrice, type TokenListPricing } from '../../../pricing/tokenPricing'

export type BailianQwenMtModelId =
  | 'qwen-mt-flash'
  | 'qwen-mt-plus'
  | 'qwen-mt-lite'

export type BailianQwenMtStreamingContent = 'incremental' | 'cumulative'

export interface BailianQwenMtPreset {
  moduleId: string
  modelId: BailianQwenMtModelId
  streamingContent: BailianQwenMtStreamingContent
  /** 华北2（北京）原价，不含限时免费额度。 */
  pricing: TokenListPricing
}

function defineQwenMtPreset(
  modelId: BailianQwenMtModelId,
  streamingContent: BailianQwenMtStreamingContent,
  pricing: TokenListPricing
): BailianQwenMtPreset {
  return {
    moduleId: `bailian.translation.${modelId}`,
    modelId,
    streamingContent,
    pricing,
  }
}

export const BAILIAN_QWEN_MT_PRESETS = {
  flash: defineQwenMtPreset('qwen-mt-flash', 'incremental', tokenListPrice('CNY', 0.7, 1.95)),
  plus: defineQwenMtPreset('qwen-mt-plus', 'cumulative', tokenListPrice('CNY', 1.8, 5.4)),
  lite: defineQwenMtPreset('qwen-mt-lite', 'incremental', tokenListPrice('CNY', 0.6, 1.6)),
} as const satisfies Record<string, BailianQwenMtPreset>

export interface BailianTranslationMemoryItem {
  source: string
  target: string
}

/** 放在 TranslationInput.options 中的百炼扩展；其余键会被明确拒绝，避免静默漏参数。 */
export interface BailianQwenMtInputOptions {
  stream?: boolean
  translationMemory?: readonly BailianTranslationMemoryItem[]
}

export interface BailianQwenMtModuleConfig {
  /** 完整 Chat Completions 地址；可替换为区域/Workspace 专属地址。 */
  endpoint?: string
  /** 输入未显式给 options.stream 时的默认值，默认开启流式。 */
  defaultStream?: boolean
}

export const DEFAULT_BAILIAN_QWEN_MT_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
