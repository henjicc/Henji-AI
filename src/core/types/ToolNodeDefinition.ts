/**
 * ToolNodeDefinition - 工具节点定义类型
 *
 * 定义工具节点的配置格式
 */

import type { I18nText } from './I18nText'
import type { InputPort, OutputPort } from './NodePort'
import type { NodeOutput } from './ModelNode'
import type { ParamDef } from './ParamDef'

/**
 * 工具节点分类
 */
export type ToolNodeCategory =
  | 'image-processing'      // 图片处理
  | 'text-processing'       // 文本处理
  | 'data-conversion'       // 数据转换
  | 'logic-control'         // 逻辑控制
  | 'utility'               // 实用工具

/**
 * 工具节点定义接口
 */
export interface ToolNodeDefinition {
  /** 工具类型（唯一标识） */
  type: string

  /** 显示名称 */
  name: I18nText

  /** 描述 */
  description?: I18nText

  /** 图标 */
  icon?: string

  /** 分类 */
  category: ToolNodeCategory

  /** 输入端口 */
  inputs: InputPort[]

  /** 输出端口 */
  outputs: OutputPort[]

  /** 执行函数 */
  execute: (inputs: Record<string, any>) => Promise<NodeOutput> | NodeOutput

  /** 配置 Schema（可选） */
  configSchema?: ParamDef[]
}
