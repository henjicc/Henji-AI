/**
 * ToolNodeRegistry - 工具节点注册表
 *
 * 管理工具节点的注册和查询
 */

import type { ToolNodeDefinition, ToolNodeCategory } from './types/ToolNodeDefinition'

/**
 * 工具节点注册表类
 */
export class ToolNodeRegistry {
  private static instance: ToolNodeRegistry
  private nodes: Map<string, ToolNodeDefinition> = new Map()

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ToolNodeRegistry {
    if (!ToolNodeRegistry.instance) {
      ToolNodeRegistry.instance = new ToolNodeRegistry()
    }
    return ToolNodeRegistry.instance
  }

  /**
   * 注册工具节点
   */
  register(def: ToolNodeDefinition): void {
    if (this.nodes.has(def.type)) {
      throw new Error(`Tool node type already exists: ${def.type}`)
    }
    this.nodes.set(def.type, def)
  }

  /**
   * 获取工具节点定义
   */
  get(type: string): ToolNodeDefinition | undefined {
    return this.nodes.get(type)
  }

  /**
   * 按分类列出工具节点
   */
  listByCategory(category: ToolNodeCategory): ToolNodeDefinition[] {
    return Array.from(this.nodes.values())
      .filter(node => node.category === category)
  }

  /**
   * 列出所有工具节点
   */
  listAll(): ToolNodeDefinition[] {
    return Array.from(this.nodes.values())
  }

  /**
   * 检查工具节点是否存在
   */
  has(type: string): boolean {
    return this.nodes.has(type)
  }
}

/**
 * 单例实例
 */
export const toolNodeRegistry = ToolNodeRegistry.getInstance()
