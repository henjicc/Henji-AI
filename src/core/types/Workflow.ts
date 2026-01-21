/**
 * Workflow - 工作流接口
 *
 * 定义完整的工作流结构
 */

import type { ModelNode } from './ModelNode'
import type { ToolNode } from './ToolNode'
import type { NodeConnection } from './NodeConnection'

/**
 * 工作流接口
 */
export interface Workflow {
  /** 工作流 ID */
  id: string

  /** 工作流名称 */
  name: string

  /** 工作流描述 */
  description?: string

  /** 节点列表 */
  nodes: Array<ModelNode | ToolNode>

  /** 连接列表 */
  connections: NodeConnection[]

  /** 元数据 */
  createdAt: Date
  updatedAt: Date
  version: string
}
