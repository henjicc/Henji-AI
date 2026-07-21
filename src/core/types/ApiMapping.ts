/**
 * API 映射类型
 *
 * 定义参数如何映射到 API 请求字段
 */

/**
 * API 字段映射（简单映射）
 *
 * 直接将 UI 参数值映射到 API 字段
 *
 * @example
 * ```typescript
 * // UI 参数 duration 映射到 API 字段 video_duration
 * apiField: 'video_duration'
 * ```
 */
export type ApiFieldMapping = string

/**
 * API 转换函数（复杂映射）
 *
 * 将 UI 参数值转换为多个 API 字段
 *
 * @example
 * ```typescript
 * // 将分辨率 "1920x1080" 转换为 width 和 height 字段
 * apiTransform: (value) => {
 *   const [width, height] = value.split('x').map(Number)
 *   return { width, height }
 * }
 * ```
 */
export type ApiTransform = (value: DynamicValue, allParams?: DynamicValueMap) => DynamicValueMap

/**
 * 端点相关 API 映射
 *
 * 根据不同的端点使用不同的字段映射
 *
 * @example
 * ```typescript
 * // 根据端点选择不同的字段名
 * apiMapping: {
 *   '/api/v1/text-to-video': 'prompt',
 *   '/api/v1/image-to-video': 'image_prompt',
 *   default: 'input_text'
 * }
 * ```
 */
export type ApiMapping = Record<string, string | ApiTransform>

/**
 * API 配置（完整配置）
 *
 * 支持简单映射、转换函数或端点相关映射
 */
export type ApiConfig = ApiFieldMapping | ApiTransform | ApiMapping
