/**
 * 端点配置类型
 *
 * 定义模型的 API 端点路由规则
 */

/**
 * 端点选择规则
 *
 * 根据条件选择不同的端点
 */
export interface EndpointRule {
  /**
   * 匹配条件
   *
   * @example
   * ```typescript
   * // 根据 mode 参数选择端点
   * when: { mode: 'text-to-video' }
   *
   * // 根据多个条件选择端点
   * when: { mode: 'image-to-video', resolution: '1080p' }
   * ```
   */
  when: Record<string, any>

  /**
   * 匹配成功时使用的端点
   *
   * @example "/api/v1/text-to-video"
   */
  endpoint: string
}

/**
 * 端点配置
 *
 * 支持三种配置方式：
 * 1. 固定字符串：所有请求使用同一端点
 * 2. 规则数组：根据参数动态选择端点
 * 3. 函数选择器：自定义端点选择逻辑
 *
 * @example
 * ```typescript
 * // 方式1：固定端点
 * endpoints: '/api/v1/generate'
 *
 * // 方式2：规则选择
 * endpoints: {
 *   rules: [
 *     { when: { mode: 'text-to-video' }, endpoint: '/api/v1/text-to-video' },
 *     { when: { mode: 'image-to-video' }, endpoint: '/api/v1/image-to-video' }
 *   ],
 *   default: '/api/v1/generate'
 * }
 *
 * // 方式3：函数选择
 * endpoints: {
 *   selector: (params) => {
 *     if (params.mode === 'text-to-video') return '/api/v1/text-to-video'
 *     return '/api/v1/generate'
 *   }
 * }
 * ```
 */
export type EndpointConfig =
  | string  // 固定端点
  | {
      /**
       * 规则数组（按顺序匹配）
       */
      rules?: EndpointRule[]

      /**
       * 默认端点（规则都不匹配时使用）
       */
      default?: string

      /**
       * 端点选择函数
       *
       * @param params - 请求参数
       * @returns 选择的端点
       */
      selector?: (params: Record<string, any>) => string | Promise<string>

      /**
       * Optional route map for multi-endpoint models.
       * When provided, selector/rules/default may return a key into this map.
       */
      routes?: Record<string, { path: string; method?: string }>
    }

/**
 * 路由定义（用于 Adapter 内部路由系统）
 *
 * @deprecated 新架构中使用 EndpointConfig 替代
 */
export interface RouteDefinition {
  /**
   * 匹配模型 ID 的函数
   */
  matches: (modelId: string) => boolean

  /**
   * 构建图片请求
   */
  buildImageRequest?: (params: any) => { endpoint: string; requestData: any }

  /**
   * 构建视频请求
   */
  buildVideoRequest?: (params: any) => { endpoint: string; requestData: any }

  /**
   * 构建音频请求
   */
  buildAudioRequest?: (params: any) => { endpoint: string; requestData: any }
}
