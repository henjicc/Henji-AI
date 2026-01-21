/**
 * ToolNode - 工具节点接口
 *
 * 定义工具节点的结构和类型
 */

import type { I18nText } from './common'
import type { InputPort, OutputPort } from './NodePort'
import type { NodeOutput } from './ModelNode'

/**
 * 工具节点类型
 */
export type ToolNodeType =
  | 'image-crop'          // 图片裁剪
  | 'image-resize'        // 图片缩放
  | 'prompt-template'     // 提示词模板
  | 'text-concat'         // 文本拼接
  | 'conditional'         // 条件分支
  | 'loop'                // 循环
  | 'convert-type'        // 类型转换
  | 'custom'              // 自定义

/**
 * 工具节点接口
 */
export interface ToolNode {
  /** 节点实例 ID */
  id: string

  /** 工具类型 */
  type: ToolNodeType

  /** 元数据 */
  meta: {
    /** 节点名称 */
    name: I18nText

    /** 节点描述 */
    description?: I18nText

    /** 图标 */
    icon?: string
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
  execute: (inputs: Record<string, any>) => Promise<NodeOutput> | NodeOutput

  /** 工具节点特有配置 */
  config?: Record<string, any>
}
