/** 每百万 tokens 的单价。 */
export interface TokenPrice {
  inputPerMillionTokens: number
  outputPerMillionTokens: number
  /** 命中上下文缓存的输入单价；供应商未单列时省略。 */
  cacheReadPerMillionTokens?: number
}

/**
 * 供应商公布的按量标准价：不含限时优惠、Batch 折扣与免费额度，只用于展示与参考估价，不代表账单。
 * 价格随供应商走：同一模型在不同平台托管，单价各自登记。
 */
export interface TokenListPricing extends TokenPrice {
  currency: 'CNY' | 'USD'
  /** 按单次请求的输入长度分档：输入超过 aboveInputTokens 时整次请求按该档结算；顶层是最低一档。 */
  tiers?: ReadonlyArray<TokenPrice & { aboveInputTokens: number }>
  /** 分时计价：顶层是高峰价（参考估价取保守值），offPeak 是其余时段的价格。 */
  offPeak?: TokenPrice & { peakHours: string }
}

/** 按“输入 / 输出 / 缓存命中”的顺序登记单价，和供应商价格表的列序一致，便于逐行对照。 */
export function tokenListPrice(currency: TokenListPricing['currency'], input: number, output: number, cacheRead?: number): TokenListPricing {
  return { currency, ...tokenPrice(input, output, cacheRead) }
}

export function tokenPrice(input: number, output: number, cacheRead?: number): TokenPrice {
  return { inputPerMillionTokens: input, outputPerMillionTokens: output, ...(cacheRead === undefined ? {} : { cacheReadPerMillionTokens: cacheRead }) }
}

/** 每个汉字约折多少 token，附官方出处；用来把 token 单价换成“每万字”的参考价。 */
export interface TextTokenRatio {
  tokensPerChineseChar: number
  source: string
}

/**
 * 换算比例跟着模型的分词器走，不跟托管平台走：硅基流动、派欧云、百炼上的 DeepSeek 仍按 DeepSeek 的比例。
 * 公布区间的取偏多一端，参考价宁可偏高。没有公布比例的模型（Qwen、豆包、MiMo、gpt-oss 等）用硅基流动对“典型中文模型”的说法，
 * 1 token 约 1–2 个汉字，同样取 1 字 1 token。
 */
const TEXT_TOKEN_RATIOS: ReadonlyArray<{ match: RegExp; ratio: TextTokenRatio }> = [
  { match: /deepseek/i, ratio: { tokensPerChineseChar: 0.6, source: 'https://api-docs.deepseek.com/zh-cn/quick_start/token_usage' } },
  { match: /kimi|moonshot/i, ratio: { tokensPerChineseChar: 1 / 1.5, source: 'https://platform.kimi.com/docs/introduction' } },
  { match: /glm/i, ratio: { tokensPerChineseChar: 1 / 1.6, source: 'https://docs.bigmodel.cn/cn/guide/start/introduction' } },
  { match: /minimax/i, ratio: { tokensPerChineseChar: 1000 / 1600, source: 'https://platform.minimax.cn/docs/pricing/overview' } },
]
const FALLBACK_TEXT_TOKEN_RATIO: TextTokenRatio = { tokensPerChineseChar: 1, source: 'https://docs.siliconflow.com/en/faqs/billing-rules' }

export function textTokenRatioFor(modelId: string): TextTokenRatio {
  return TEXT_TOKEN_RATIOS.find(item => item.match.test(modelId))?.ratio ?? FALLBACK_TEXT_TOKEN_RATIO
}

/** 按顶层单价（最低档、高峰时段）估算一段中文输入与输出的费用，币种同 pricing。 */
export function estimateChineseTextCost(pricing: TokenListPricing, ratio: TextTokenRatio, chars: { input: number; output: number }): number {
  return (chars.input * pricing.inputPerMillionTokens + chars.output * pricing.outputPerMillionTokens) * ratio.tokensPerChineseChar / 1_000_000
}
