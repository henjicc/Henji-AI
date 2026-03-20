import { createLogger } from '@/core/logging'

const logger = createLogger('core.NodeConverter')
/**
 * NodeConverter - 节点转换器
 *
 * 将 ModelDefinition 转换为 ModelNode
 */

import { registry } from './ModelRegistry'
import { requestBuilder } from './request/RequestBuilder'
import type {

  ModelDefinition,
  ParamDef,
  ModelNode,
  InputPort,
  OutputPort,
  PortDataType,
  NodeExecutor,
  I18nText,
  INodeConverter
} from './types'

/**
 * 节点转换器类
 */
export class NodeConverter implements INodeConverter {
  private static instance: NodeConverter
  private cache: Map<string, ModelNode> = new Map()

  private constructor() { }

  /**
   * 获取单例实例
   */
  static getInstance(): NodeConverter {
    if (!NodeConverter.instance) {
      NodeConverter.instance = new NodeConverter()
    }
    return NodeConverter.instance
  }

  /**
   * 将模型定义转换为节点定义
   */
  modelToNode(model: ModelDefinition): ModelNode {
    // 检查缓存
    if (this.cache.has(model.meta.id)) {
      return this.cache.get(model.meta.id)!
    }

    // 转换
    const node: ModelNode = {
      id: `node-${model.meta.id}`,
      type: 'model',
      modelId: model.meta.id,

      meta: {
        name: model.meta.name,
        description: model.meta.description,
        icon: model.meta.icon,
        category: model.meta.type,
        tags: model.meta.tags
      },

      inputs: this.paramsToInputPorts(model.params),
      outputs: this.getOutputPorts(model.meta.type),

      execute: this.createExecutor(model)
    }

    // 缓存
    this.cache.set(model.meta.id, node)

    return node
  }

  /**
   * 将参数定义转换为输入端口
   */
  paramsToInputPorts(params: ParamDef[]): InputPort[] {
    const ports: InputPort[] = []

    for (const param of params) {
      // 跳过纯 UI 参数（如分隔符）
      if ((param.type as string) === 'divider') continue

      // 基础端口
      const port: InputPort = {
        id: param.id,
        name: param.name,
        type: this.paramTypeToPortType(param),
        required: param.required ?? false,
        default: param.default,
        description: param.tooltip
      }

      ports.push(port)
    }

    return ports
  }

  /**
   * 根据模型类型生成输出端口
   */
  getOutputPorts(modelType: 'image' | 'video' | 'audio'): OutputPort[] {
    const baseOutput: OutputPort = {
      id: 'output',
      name: this.getOutputName(modelType),
      type: modelType,
      description: {
        zh: `生成的${this.getTypeLabel(modelType)}`,
        en: `Generated ${modelType}`
      }
    }

    const metadataOutput: OutputPort = {
      id: 'metadata',
      name: { zh: '元数据', en: 'Metadata' },
      type: 'object',
      description: { zh: '生成任务的元数据', en: 'Task metadata' }
    }

    return [baseOutput, metadataOutput]
  }

  /**
   * 参数类型转换为端口类型
   */
  private paramTypeToPortType(param: ParamDef): PortDataType {
    switch (param.type) {
      case 'text':
      case 'dropdown':
        return 'string'
      case 'number':
        return 'number'
      case 'switch':
        return 'boolean'
      case 'image-upload':
        return 'image'
      case 'video-upload':
        return 'video'
      case 'panel':
        // 根据面板类型决定
        if ((param as any).panelType === 'resolution') return 'object'
        return 'any'
      default:
        return 'any'
    }
  }

  /**
   * 获取输出名称
   */
  private getOutputName(type: string): I18nText {
    const names: Record<string, I18nText> = {
      image: { zh: '图片', en: 'Image' },
      video: { zh: '视频', en: 'Video' },
      audio: { zh: '音频', en: 'Audio' }
    }
    return names[type] || { zh: '输出', en: 'Output' }
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      image: '图片',
      video: '视频',
      audio: '音频'
    }
    return labels[type] || '内容'
  }

  /**
   * 创建节点执行器
   */
  private createExecutor(model: ModelDefinition): NodeExecutor {
    return async (inputs, context) => {
      try {
        // 1. 构建请求参数
        const params = this.inputsToParams(inputs, model.params)

        // 2. 使用 RequestBuilder 构建请求
        // const _request = requestBuilder.build(model.meta.id, params, {
        //   context: context || {}
        // })

        // 3. 调用适配器（这里简化处理，实际应该通过 ApiService）
        // TODO: 集成 ApiService 进行实际调用

        // 临时返回模拟数据
        return {
          output: null,
          metadata: {
            status: 'pending',
            error: 'Node execution not fully implemented yet'
          }
        }
      } catch (error: any) {
        logger.error(`Node execution failed:`, error)
        return {
          output: null,
          metadata: {
            status: 'failed',
            error: error.message
          }
        }
      }
    }
  }

  /**
   * 输入转换为参数
   */
  private inputsToParams(
    inputs: Record<string, any>,
    paramDefs: ParamDef[]
  ): Record<string, any> {
    const params: Record<string, any> = {}

    for (const paramDef of paramDefs) {
      const value = inputs[paramDef.id]
      if (value !== undefined) {
        params[paramDef.id] = value
      } else if (paramDef.default !== undefined) {
        params[paramDef.id] = paramDef.default
      }
    }

    return params
  }

  /**
   * 批量转换所有模型
   */
  convertAllModels(filter?: {
    provider?: string
    type?: 'image' | 'video' | 'audio'
    tags?: string[]
  }): ModelNode[] {
    let models = registry.listAllModels()

    // 应用过滤
    if (filter?.provider) {
      models = models.filter(m => m.meta.provider === filter.provider)
    }
    if (filter?.type) {
      models = models.filter(m => m.meta.type === filter.type)
    }
    if (filter?.tags) {
      models = models.filter(m =>
        filter.tags!.some(tag => m.meta.tags?.includes(tag as any))
      )
    }

    return models.map(model => this.modelToNode(model))
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }
}

/**
 * 单例实例
 */
export const nodeConverter = NodeConverter.getInstance()

