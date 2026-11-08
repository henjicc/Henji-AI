import { tokenUsagePrice } from '../../../pricing/capabilityPricing'

/**
 * Qwen-Audio 3.1 识别按 token 计价，官方没写每秒音频折多少 token。
 * 2026-11-08 实调短音频（不传上下文）：4.85 秒输入 61、30.6 秒输入 383 token，即每秒 12.5、没有固定开销；传了上下文文字会另计输入。
 * 输出实测约 0.5 token/字，按每秒 6 个汉字（快语速）估为每秒 3 token。
 * 文件转写与短音频同模型同价，按同样比例；流式无法用同一方式实测，按官方流式示例（2 秒 85、9 秒 365）取偏多的每秒 42.5。
 * 单价为华北2（北京）原价，见 docs/model-adaptation/供应商/百炼.md。
 */
export const QWEN_AUDIO_31_FILE_PRICING = tokenUsagePrice('CNY', 0.8, 2.7, {
  audioTokenRate: { inputTokensPerSecond: 12.5, outputTokensPerSecond: 3, source: '2026-11-08 短音频实调' },
})

export const QWEN_AUDIO_31_STREAMING_PRICING = tokenUsagePrice('CNY', 6, 4.5, {
  audioTokenRate: { inputTokensPerSecond: 42.5, outputTokensPerSecond: 3, source: '官方流式示例：2 秒 85、9 秒 365 token' },
})
