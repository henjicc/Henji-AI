/**
 * 价格配置类型
 *
 * 定义模型的价格计算规则
 */

import type { RuntimePricingMediaContextRequirement } from '@henjicc/ai-sdk'

/**
 * 计价单位
 *
 * 前四个是货币符号，可按汇率互相换算。
 * `魔粒` 是魔搭 ModelScope 的积分单位：不是货币、无法充值、靠每日登录等行为免费获取，
 * 因此不参与汇率换算，展示时按「数量 + 单位」渲染。
 */
export type Currency = '¥' | '$' | '€' | '£' | '魔粒'

/** 非货币计价单位，不参与汇率换算 */
export const NON_MONETARY_CURRENCIES: readonly Currency[] = ['魔粒']

export function isNonMonetaryCurrency(currency?: string): boolean {
  return currency === '魔粒'
}

/**
 * 价格配置
 *
 * 支持固定价格和动态计算
 *
 * @example
 * ```typescript
 * // 固定价格
 * pricing: {
 *   currency: '¥',
 *   fixed: 0.1
 * }
 *
 * // 动态计算
 * pricing: {
 *   currency: '$',
 *   calculator: (params) => {
 *     const basePrice = 0.05
 *     const resolution = params.resolution || '512x512'
 *     const [width, height] = resolution.split('x').map(Number)
 *     const pixels = width * height
 *
 *     // 根据分辨率计算价格
 *     if (pixels > 1024 * 1024) return basePrice * 2
 *     return basePrice
 *   }
 * }
 * ```
 */
export interface PricingConfig {
  /**
   * 货币符号
   *
   * @default '¥'
   */
  currency: Currency

  /**
   * 固定价格
   *
   * 如果提供了 calculator，此字段作为默认值
   */
  fixed?: number

  /**
   * 动态价格计算函数
   *
   * @param params - 当前参数
   * @returns 计算出的价格
   *
   * @example
   * ```typescript
   * calculator: (params) => {
   *   // 根据视频时长计算价格
   *   const duration = params.duration || 5
   *   const pricePerSecond = 0.02
   *   return duration * pricePerSecond
   * }
   * ```
   */
  calculator?: (params: DynamicValueMap) => number

  /** calculator 返回的是完整预估总价，还是仅供参考的计价单位单价。 */
  estimateMode?: 'total' | 'unit'

  /** estimateMode=unit 时展示的单位，例如 MP。 */
  estimateUnit?: string

  /** 由宿主统一解析并注入 calculator 的媒体元数据需求。 */
  mediaContext?: RuntimePricingMediaContextRequirement[]

  /**
   * 价格说明（可选）
   *
   * @example "按视频时长计费：¥0.02/秒"
   */
  description?: string
}
