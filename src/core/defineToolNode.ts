/**
 * defineToolNode - 工具节点定义辅助函数
 *
 * 提供工具节点定义的辅助方法
 */

import { toolNodeRegistry } from './ToolNodeRegistry'
import type { ToolNodeDefinition } from './types/ToolNodeDefinition'

/**
 * 定义工具节点
 *
 * @param def - 工具节点定义
 * @returns 工具节点定义
 */
export function defineToolNode(def: ToolNodeDefinition): ToolNodeDefinition {
  // 验证定义
  if (!def.type) {
    throw new Error('Tool node type is required')
  }
  if (!def.name) {
    throw new Error('Tool node name is required')
  }
  if (!def.execute) {
    throw new Error('Tool node execute function is required')
  }

  // 自动注册
  toolNodeRegistry.register(def)

  return def
}
