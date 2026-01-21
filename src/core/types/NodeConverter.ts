/**
 * NodeConverter - 节点转换器接口
 *
 * 定义从 ModelDefinition 到 ModelNode 的转换接口
 */

import type { ModelDefinition, ParamDef } from './model'
import type { ModelNode } from './ModelNode'
import type { InputPort, OutputPort } from './NodePort'

/**
 * 节点转换器接口
 */
export interface INodeConverter {
  /**
   * 将模型定义转换为节点定义
   */
  modelToNode(model: ModelDefinition): ModelNode

  /**
   * 将参数定义转换为输入端口
   */
  paramsToInputPorts(params: ParamDef[]): InputPort[]

  /**
   * 根据模型类型生成输出端口
   */
  getOutputPorts(modelType: 'image' | 'video' | 'audio'): OutputPort[]
}
