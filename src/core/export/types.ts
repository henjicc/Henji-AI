/**
 * Export System Type Definitions
 *
 * 定义导出系统的核心类型
 */

/**
 * 导出类型
 */
export type ExportType =
  | 'current-params'    // 当前参数值
  | 'model-config'      // 完整模型配置
  | 'model-schema'      // 模型参数 Schema
  | 'api-request'       // API 请求体
  | 'preset'            // 预设格式

/**
 * 导出数据结构
 */
export interface ExportData {
  /**
   * 导出格式版本
   */
  version: string

  /**
   * 导出类型
   */
  type: ExportType

  /**
   * 导出时间戳
   */
  timestamp: number

  /**
   * 模型 ID
   */
  modelId: string

  /**
   * 导出的数据
   */
  data: DynamicValue

  /**
   * 元数据（可选）
   */
  metadata?: {
    /**
     * 应用版本
     */
    appVersion?: string

    /**
     * 平台信息
     */
    platform?: string

    /**
     * 其他自定义元数据
     */
    [key: string]: DynamicValue
  }
}

/**
 * 清理选项
 */
export interface CleanOptions {
  /**
   * 移除默认值
   */
  removeDefaults?: boolean

  /**
   * 移除空值
   */
  removeEmpty?: boolean

  /**
   * 移除敏感信息
   */
  removeSensitive?: boolean

  /**
   * 移除 Base64 数据
   */
  removeBase64?: boolean
}

/**
 * 导出选项
 */
export interface ExportOptions {
  /**
   * 清理选项
   */
  clean?: CleanOptions

  /**
   * 自定义文件名
   */
  filename?: string

  /**
   * 是否美化 JSON
   */
  prettify?: boolean

  /**
   * 是否包含元数据
   */
  includeMetadata?: boolean
}

