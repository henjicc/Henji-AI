import type { TokenListPricing } from './tokenPricing'

/** 按输入音频时长计费，输出不计费。 */
export interface AudioDurationPricing {
  billing: 'audio-duration'
  currency: 'CNY' | 'USD'
  perSecond: number
  /** 单次请求不足这个秒数时按这个秒数计费。 */
  minimumSeconds?: number
}

/**
 * 按 token 计费。音频模型的官方价格表只给 token 单价、不给每秒折多少 token 时，
 * audioTokenRate 记录实测或官方示例的折算比例，供按音频时长估价；它是估算依据，不是供应商承诺。
 */
export interface TokenUsagePricing extends TokenListPricing {
  billing: 'tokens'
  audioTokenRate?: {
    inputTokensPerSecond: number
    outputTokensPerSecond: number
    /** 折算比例从哪来：实测日期或官方示例。 */
    source: string
  }
}

/**
 * 能力描述上的按量标准价：不含免费额度、限时优惠与 Batch 折扣，只用于展示与参考估价，不代表账单。
 * 区分地域的供应商只登记一个地域（百炼为华北2北京），调用方配置其他地域端点时这份价格不适用。
 * 内置预设之间会共用同一个价格对象，所以构造函数返回冻结对象。
 */
export type CapabilityPricing = AudioDurationPricing | TokenUsagePricing

export function audioDurationPrice(
  currency: AudioDurationPricing['currency'],
  perSecond: number,
  minimumSeconds?: number,
): AudioDurationPricing {
  return Object.freeze({ billing: 'audio-duration', currency, perSecond, ...(minimumSeconds === undefined ? {} : { minimumSeconds }) })
}

/** 按“输入 / 输出 / 缓存命中”的顺序登记每百万 tokens 单价。 */
export function tokenUsagePrice(
  currency: TokenUsagePricing['currency'],
  input: number,
  output: number,
  extra: Pick<TokenUsagePricing, 'cacheReadPerMillionTokens' | 'audioTokenRate'> = {},
): TokenUsagePricing {
  const rate = extra.audioTokenRate ? Object.freeze({ ...extra.audioTokenRate }) : undefined
  return Object.freeze({ billing: 'tokens', currency, inputPerMillionTokens: input, outputPerMillionTokens: output, ...extra, ...(rate ? { audioTokenRate: rate } : {}) })
}

/**
 * 按音频时长估一次请求的费用，币种同 pricing。按 token 计费且没有 audioTokenRate 时无法从时长推算，返回 null。
 * token 计费按顶层单价（最低档、高峰时段）估。
 */
export function estimateAudioDurationCost(
  pricing: CapabilityPricing,
  durationMs: number,
): { amount: number; currency: CapabilityPricing['currency'] } | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  const seconds = durationMs / 1000
  if (pricing.billing === 'audio-duration') {
    return { amount: Math.max(seconds, pricing.minimumSeconds ?? 0) * pricing.perSecond, currency: pricing.currency }
  }
  const rate = pricing.audioTokenRate
  if (!rate) return null
  const amount = seconds * (rate.inputTokensPerSecond * pricing.inputPerMillionTokens + rate.outputTokensPerSecond * pricing.outputPerMillionTokens) / 1_000_000
  return { amount, currency: pricing.currency }
}

/** 校验单价都是有限非负数；能力描述注册与建立发现索引时调用。 */
export function isValidCapabilityPricing(pricing: unknown): pricing is CapabilityPricing {
  if (typeof pricing !== 'object' || pricing === null) return false
  const value = pricing as Record<string, unknown>
  const price = (input: unknown): boolean => typeof input === 'number' && Number.isFinite(input) && input >= 0
  const optionalPrice = (input: unknown): boolean => input === undefined || price(input)
  if (value.currency !== 'CNY' && value.currency !== 'USD') return false
  if (value.billing === 'audio-duration') return price(value.perSecond) && optionalPrice(value.minimumSeconds)
  if (value.billing !== 'tokens') return false
  const tokenPrices = (input: Record<string, unknown>): boolean =>
    price(input.inputPerMillionTokens) && price(input.outputPerMillionTokens) && optionalPrice(input.cacheReadPerMillionTokens)
  if (!tokenPrices(value)) return false
  const rate = value.audioTokenRate as Record<string, unknown> | undefined
  if (rate !== undefined && !(typeof rate === 'object' && rate !== null && price(rate.inputTokensPerSecond) && price(rate.outputTokensPerSecond) && typeof rate.source === 'string')) return false
  const tiers = value.tiers
  if (tiers !== undefined && !(Array.isArray(tiers) && tiers.every((tier) => typeof tier === 'object' && tier !== null && tokenPrices(tier) && price((tier as Record<string, unknown>).aboveInputTokens)))) return false
  const offPeak = value.offPeak as Record<string, unknown> | undefined
  return offPeak === undefined || (typeof offPeak === 'object' && offPeak !== null && tokenPrices(offPeak) && typeof offPeak.peakHours === 'string')
}
