/**
 * Provider 基础类型定义
 *
 * 定义所有 Provider 系统共享的类型接口
 */

import type { AiRuntimeTrace } from '@/core/types'

/**
 * 生成结果接口
 */
export interface GenerateResult {
  /** 媒体文件URL（可能是远程URL或本地asset://协议） */
  url: string
  /** 本地文件路径（如果已保存到本地） */
  filePath?: string
  /** 任务ID（用于异步任务跟踪） */
  taskId?: string
  /** 生成状态 */
  status: 'completed' | 'pending' | 'failed'
  /** 额外元数据 */
  metadata?: DynamicValueMap
  /** 真实 API 请求/响应追踪 */
  trace?: AiRuntimeTrace
}

/**
 * 进度状态接口（用于轮询）
 */
export interface ProgressStatus {
  /** 任务状态 */
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'TASK_CREATED'
  /** 队列位置 */
  queue_position?: number
  /** 状态消息 */
  message?: string
  /** 进度百分比 (0-100) */
  progress?: number
  /** 结果数据（COMPLETED时） */
  result?: DynamicValue
  /** 错误信息（FAILED时） */
  error?: string
}

/**
 * Provider 配置接口
 */
export interface ProviderConfig {
  /** Provider名称 */
  name: string
  /** API基础URL */
  baseURL: string
  /** API密钥 */
  apiKey: string
  /** 请求超时时间（毫秒） */
  timeout?: number
  /** 额外配置 */
  options?: DynamicValueMap
}

/**
 * 轮询配置接口
 */
export interface PollingConfig {
  /** 轮询间隔（毫秒） */
  interval: number
  /** 最大轮询次数 */
  maxAttempts: number
  /** 预期轮询次数（用于进度估算） */
  expectedAttempts?: number
  /** 轮询超时时间（毫秒，可选） */
  timeout?: number
}

/**
 * 预处理参数接口
 */
export interface PreprocessedParams {
  /** 处理后的参数 */
  params: DynamicValueMap
  /** 上传的文件映射 */
  uploadedFiles?: Map<string, string>
  /** 额外元数据 */
  metadata?: DynamicValueMap
}

/**
 * API响应接口（通用）
 */
export interface ApiResponse<T = DynamicValue> {
  /** 响应数据 */
  data: T
  /** 状态码 */
  status: number
  /** 状态消息 */
  message?: string
  /** 错误信息 */
  error?: string
}

/**
 * 文件上传结果接口
 */
export interface UploadResult {
  /** 上传后的URL */
  url: string
  /** 文件ID（如果API返回） */
  fileId?: string
  /** 文件类型 */
  mimeType?: string
  /** 文件大小（字节） */
  size?: number
}

/**
 * 媒体保存选项
 */
export interface SaveMediaOptions {
  /** 媒体类型 */
  type: 'image' | 'video' | 'audio'
  /** 是否保存到本地 */
  saveLocally?: boolean
  /** 自定义文件名 */
  filename?: string
  /** 额外元数据 */
  metadata?: DynamicValueMap
}
