/**
 * ModelNode - 模型节点接口
 *
 * 定义模型节点的结构和执行接口
 */

import type { I18nText } from './common'
import type { InputPort, OutputPort } from './NodePort'
import type { ProgressStatus } from './progress'

/**
 * 节点输出
 */
export interface NodeOutput {
  /** 每个输出端口的值 */
  [portId: string]: any

  /** 元数据 */
  _metadata?: {
    taskId?: string
    status?: string
    error?: string
  }
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** 进度回调 */
  onProgress?: (status: ProgressStatus) => void

  /** 取消信号 */
  signal?: AbortSignal
}

/**
 * 节点执行器
 */
export type NodeExecutor = (
  inputs: Record<string, any>,
  context?: ExecutionContext
) => Promise<NodeOutput>

/**
 * 模型节点接口
 */
export interface ModelNode {
  /** 节点实例 ID（运行时生成） */
  id: string

  /** 节点类型 */
  type: 'model'

  /** 对应的模型 ID */
  modelId: string

  /** 元数据 */
  meta: {
    /** 节点名称 */
    name: I18nText

    /** 节点描述 */
    description?: I18nText

    /** 图标 */
    icon?: string

    /** 分类 */
    category: 'image' | 'video' | 'audio'

    /** 标签 */
    tags?: string[]
  }

  /** 输入端口 */
  inputs: InputPort[]

  /** 输出端口 */
  outputs: OutputPort[]

  /** 位置信息（画布中的位置） */
  position?: {
    x: number
    y: number
  }

  /** 执行函数 */
  execute: NodeExecutor
}
