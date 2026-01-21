/**
 * 请求配置类型
 *
 * 定义如何构建 API 请求
 */

/**
 * 请求构建配置
 *
 * @example
 * ```typescript
 * request: {
 *   // 基础字段映射
 *   base: {
 *     prompt: 'input.prompt',
 *     size: 'input.resolution'
 *   },
 *
 *   // 预处理函数
 *   preprocess: (params) => {
 *     return {
 *       ...params,
 *       prompt: params.prompt.trim()
 *     }
 *   }
 * }
 * ```
 */
export interface RequestConfig {
  /**
   * 基础字段映射
   *
   * 键：API 字段名
   * 值：UI 参数路径（支持点号分隔）
   *
   * @example
   * ```typescript
   * {
   *   prompt: 'input.prompt',      // API 的 prompt 字段来自 UI 的 input.prompt
   *   size: 'options.resolution',  // API 的 size 字段来自 UI 的 options.resolution
   *   num_images: 'options.count'  // API 的 num_images 字段来自 UI 的 options.count
   * }
   * ```
   */
  base?: Record<string, string>

  /**
   * 请求预处理函数
   *
   * 在发送请求前对参数进行转换或验证
   *
   * @param params - UI 参数
   * @returns 处理后的参数
   *
   * @example
   * ```typescript
   * preprocess: (params) => {
   *   // 转换分辨率格式
   *   if (params.resolution) {
   *     const [width, height] = params.resolution.split('x')
   *     return {
   *       ...params,
   *       width: parseInt(width),
   *       height: parseInt(height)
   *     }
   *   }
   *   return params
   * }
   * ```
   */
  preprocess?: (params: Record<string, any>) => Record<string, any>

  /**
   * 自定义请求构建函数
   *
   * 完全自定义如何构建请求
   *
   * @param params - UI 参数
   * @returns 请求数据
   *
   * @example
   * ```typescript
   * builder: (params) => {
   *   return {
   *     model: 'gpt-4',
   *     messages: [
   *       { role: 'user', content: params.prompt }
   *     ],
   *     max_tokens: params.maxTokens || 1000
   *   }
   * }
   * ```
   */
  builder?: (params: Record<string, any>) => Record<string, any>
}
