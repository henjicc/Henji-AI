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
  select(params: Record<string, any>, context: SelectContext): SelectResult {
    const endpointKey = this.selectEndpoint(params, context)
    const route = this.getRoute(endpointKey)

    if (!route) {
      throw new Error(`[EndpointSelector] Endpoint route not found: ${endpointKey}`)
    }

    return { endpoint: endpointKey, route }
  }

  /**
   * 选择端点键
   *
   * @param params - 参数对象
   * @param context - 选择上下文
   * @returns 端点键
   */
  private selectEndpoint(params: Record<string, any>, context: SelectContext): string {
    // 1. 单端点简化配置
    if (typeof this.config === 'object' && 'default' in this.config && typeof this.config.default === 'string') {
      return 'default'
    }

    // 2. 函数选择器
    if (typeof this.config === 'object' && 'select' in this.config && typeof this.config.select === 'function') {
      const result = this.config.select(params, context)
      if (!result) {
        throw new Error('[EndpointSelector] Function selector returned null/undefined')
      }
      return result
    }

    // 3. 规则选择器
    if (typeof this.config === 'object' && 'select' in this.config && this.config.select && typeof this.config.select === 'object' && 'rules' in this.config.select) {
      const rules = (this.config.select as any).rules
      for (const rule of rules) {
        // 无条件规则（默认端点）
        if (!rule.condition) {
          return rule.endpoint
        }

        // 有条件规则
        if (this.evaluateCondition(rule.condition, params, context)) {
          return rule.endpoint
        }
      }
    }

    throw new Error('[EndpointSelector] No endpoint matched')
  }

  /**
   * 求值条件表达式
   *
   * @param condition - 条件表达式字符串
   * @param params - 参数对象
   * @param context - 选择上下文
   * @returns 条件是否满足
   */
  private evaluateCondition(
    condition: string,
    params: Record<string, any>,
    context: SelectContext
  ): boolean {
    try {
      // 创建安全的求值环境
      // 使用 with 语句允许直接访问 params 和 context 中的属性
      const fn = new Function(
        'params',
        'context',
        `
        with (params) {
          with (context) {
            return ${condition}
          }
        }
      `
      )
      return Boolean(fn(params, context))
    } catch (error) {
      console.error('[EndpointSelector] Condition evaluation error:', error)
      console.error('[EndpointSelector] Condition:', condition)
      return false
    }
  }

  /**
   * 获取路由定义
   *
   * @param endpointKey - 端点键
   * @returns 路由定义
   */
  private getRoute(endpointKey: string): { path: string; method?: string } | undefined {
    // 单端点简化配置
    if (typeof this.config === 'object' && 'default' in this.config && typeof this.config.default === 'string') {
      return { path: this.config.default, method: 'POST' }
    }

    // 多端点配置
    if (typeof this.config === 'object' && 'routes' in this.config && this.config.routes) {
      return (this.config.routes as any)[endpointKey]
    }

    return undefined
  }
}
