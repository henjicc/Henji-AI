/**
 * 价格配置类型
 *
 * 定义模型的价格计算规则
 */

/**
 * 货币符号
 */
export type Currency = '¥' | '$' | '€' | '£'

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
  calculator?: (params: Record<string, any>) => number

  /**
   * 价格说明（可选）
   *
   * @example "按视频时长计费：¥0.02/秒"
   */
  description?: string
}
