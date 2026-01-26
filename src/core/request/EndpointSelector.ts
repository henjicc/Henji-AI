/**
 * 端点选择器
 *
 * 根据参数和上下文自动选择正确的 API 端点
 */

import type { EndpointConfig } from '../types'

/**
 * 选择结果接口
 */
export interface SelectResult {
  /**
   * 端点键
   */
  endpoint: string

  /**
   * 路由信息
   */
  route: { path: string; method?: string }
}

/**
 * 选择上下文接口
 */
export interface SelectContext {
  /**
   * 上传的图片 URL 列表
   */
  uploadedImages?: string[]

  /**
   * 上传的视频 URL 列表
   */
  uploadedVideos?: string[]

  /**
   * 是否有图片
   */
  hasImage?: boolean

  /**
   * 是否有视频
   */
  hasVideo?: boolean

  /**
   * 自定义上下文
   */
  [key: string]: any
}

/**
 * 端点选择器类
 *
 * 支持三种选择方式：
 * 1. 单端点简化配置（直接字符串）
 * 2. 函数选择器（自定义函数）
 * 3. 规则选择器（条件表达式数组）
 */
export class EndpointSelector {
  constructor(private config: EndpointConfig) { }

  /**
   * 选择端点
   *
   * @param params - 参数对象
   * @param context - 选择上下文
   * @returns 选择结果
   *
   * @example
   * ```typescript
   * const selector = new EndpointSelector(config)
   * const result = selector.select(
   *   { mode: 'reference' },
   *   { hasImage: true }
   * )
   * // { endpoint: 'reference-to-video', route: { path: '/v2v', method: 'POST' } }
   * ```
   */
  async select(params: Record<string, any>, context: SelectContext): Promise<SelectResult> {
    const endpoint = await this.selectEndpoint(params, context)
    const route = this.getRoute(endpoint)
    return { endpoint, route }
  }

  /**
   * 选择端点键
   *
   * @param params - 参数对象
   * @param context - 选择上下文
   * @returns 端点键
   */
  private async selectEndpoint(params: Record<string, any>, context: SelectContext): Promise<string> {
    // 1) Fixed endpoint
    if (typeof this.config === 'string') {
      return this.config
    }

    // 2) Function selector
    if (typeof this.config === 'object' && this.config.selector) {
      const resultRaw = this.config.selector(params)
      const result = resultRaw instanceof Promise ? await resultRaw : resultRaw
      if (!result) {
        throw new Error('[EndpointSelector] selector returned null/undefined')
      }
      return result
    }

    // 3) Rule selection
    if (typeof this.config === 'object' && this.config.rules) {
      for (const rule of this.config.rules) {
        if (!rule.when) return rule.endpoint
        if (this.matchesWhen(rule.when, params, context)) return rule.endpoint
      }
    }

    // 4) Default endpoint
    if (typeof this.config === 'object' && typeof this.config.default === 'string') {
      return this.config.default
    }

    throw new Error('[EndpointSelector] No endpoint matched')
  }

  private matchesWhen(when: Record<string, any>, params: Record<string, any>, context: SelectContext): boolean {
    return Object.entries(when).every(([key, expected]) => {
      const value = key in params ? params[key] : context[key]
      return value === expected
    })
  }

  /**
   * 获取路由定义
   *
   * @param endpointKey - 端点键
   * @returns 路由定义
   */
  private getRoute(endpoint: string): { path: string; method?: string } {
    return { path: endpoint, method: 'POST' }
  }
}
