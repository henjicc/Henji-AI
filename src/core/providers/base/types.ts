/**
 * Provider 基础类型定义
 *
 * 定义所有 Provider 系统共享的类型接口
 */

import type { AiRuntimeTrace } from '@/core/types'
import type { JsonObject, StructuredGenerationOutput } from '@henjicc/ai-sdk'

/**
 * 生成结果接口
 */
export interface GenerateResult {
  /** 结果地址，按输出顺序（远程地址或本地显示地址） */
  urls: string[]
  /** 已保存到本地的结果文件，按输出顺序；没保存时为空数组 */
  filePaths: string[]
  /** 本次运行新建的受管媒体，转移到权威结果后由调用方释放。 */
  createdFilePaths?: string[]
  /** 任务ID（用于异步任务跟踪） */
  taskId?: string
  /** 生成状态 */
  status: 'completed' | 'pending' | 'failed'
  /** 额外元数据 */
  metadata?: DynamicValueMap
  structuredOutput?: StructuredGenerationOutput
  /** 这次结果能做的续接生成：动作标识 → 平台引用；随结果保存，续接时原样交回模型 */
  continuations?: Record<string, JsonObject>
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

