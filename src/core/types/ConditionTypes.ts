/**
 * 条件类型定义
 *
 * 定义参数的显示和禁用条件
 */

/**
 * 条件表达式
 *
 * 使用 JavaScript 表达式字符串
 *
 * @example
 * ```typescript
 * // 简单条件
 * 'mode === "text-to-video"'
 *
 * // 复杂条件
 * 'mode === "image-to-video" && resolution !== "4k"'
 *
 * // 使用函数
 * 'images.length > 0'
 * ```
 */
export type ConditionExpression = string

/**
 * 条件函数
 *
 * 使用函数进行条件判断
 *
 * @param params - 当前所有参数值
 * @returns 是否满足条件
 *
 * @example
 * ```typescript
 * (params) => {
 *   return params.mode === 'image-to-video' && params.images.length > 0
 * }
 * ```
 */
export type ConditionFunction = (params: DynamicValueMap) => boolean

/**
 * 显示条件
 *
 * 控制参数是否显示
 *
 * @example
 * ```typescript
 * // 使用表达式
 * visible: {
 *   condition: 'mode === "image-to-video"'
 * }
 *
 * // 使用函数
 * visible: {
 *   condition: (params) => params.mode === 'image-to-video'
 * }
 *
 * // 带说明
 * visible: {
 *   condition: 'mode === "motion-control"',
 *   reason: '仅在动作控制模式下显示'
 * }
 * ```
 */
export interface VisibleCondition {
  /**
   * 条件（表达式或函数）
   */
  condition: ConditionExpression | ConditionFunction

  /**
   * 条件说明（可选，用于调试）
   */
  reason?: string
}

/**
 * 禁用条件
 *
 * 控制参数是否禁用（显示但不可编辑）
 *
 * @example
 * ```typescript
 * disabled: {
 *   condition: 'fastMode === true',
 *   reason: '快速模式下不可修改分辨率'
 * }
 * ```
 */
export interface DisabledCondition {
  /**
   * 条件（表达式或函数）
   */
  condition: ConditionExpression | ConditionFunction

  /**
   * 禁用原因（显示给用户）
   */
  reason?: string
}

/**
 * 智能匹配配置
 *
 * 根据上传的图片/视频自动匹配最佳参数值
 *
 * @example
 * ```typescript
 * smartMatch: {
 *   targetParam: 'aspectRatio',
 *   matcher: (uploadedFile) => {
 *     const { width, height } = uploadedFile.dimensions
 *     const ratio = width / height
 *     if (ratio > 1.5) return '16:9'
 *     if (ratio > 1) return '4:3'
 *     return '1:1'
 *   }
 * }
 * ```
 */
export interface SmartMatchConfig {
  /**
   * 目标参数 ID
   *
   * 智能匹配的结果将设置到这个参数
   */
  targetParam: string

  /**
   * 匹配函数
   *
   * @param uploadedFile - 上传的文件信息
   * @returns 匹配的参数值
   */
  matcher: (uploadedFile: {
    url: string
    filePath?: string
    dimensions?: { width: number; height: number }
    duration?: number
    size?: number
  }) => DynamicValue

  /**
   * 是否自动应用（默认 true）
   *
   * false 时只建议，不自动设置
   */
  autoApply?: boolean
}
