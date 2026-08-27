export type BailianQwenMtModelId =
  | 'qwen-mt-flash'
  | 'qwen-mt-plus'
  | 'qwen-mt-lite'

export type BailianQwenMtStreamingContent = 'incremental' | 'cumulative'

export interface BailianQwenMtPreset {
  moduleId: string
  modelId: BailianQwenMtModelId
  streamingContent: BailianQwenMtStreamingContent
}

export const BAILIAN_QWEN_MT_PRESETS = {
  flash: {
    moduleId: 'bailian.translation.qwen-mt-flash',
    modelId: 'qwen-mt-flash',
    streamingContent: 'incremental',
  },
  plus: {
    moduleId: 'bailian.translation.qwen-mt-plus',
    modelId: 'qwen-mt-plus',
    streamingContent: 'cumulative',
  },
  lite: {
    moduleId: 'bailian.translation.qwen-mt-lite',
    modelId: 'qwen-mt-lite',
    streamingContent: 'incremental',
  },
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
