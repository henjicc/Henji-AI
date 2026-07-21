/**
 * ComponentRegistry - 组件注册中心
 *
 * 管理 CompositePanel 可用的子组件
 */

import React from 'react'
import type { ComponentType } from '@/core/types/CompositePanel'

/**
 * 组件注册中心类
 */
class ComponentRegistry {
  private components: Map<ComponentType, React.ComponentType<DynamicValue>> = new Map()

  /**
   * 注册组件
   * @param type 组件类型
   * @param component 组件
   */
  register(type: ComponentType, component: React.ComponentType<DynamicValue>): void {
    if (this.components.has(type)) {
      // 已注册则跳过（支持 React StrictMode 的双重调用）
      return
    }
    this.components.set(type, component)
  }

  /**
   * 获取组件
   * @param type 组件类型
   * @returns 组件或 undefined
   */
  get(type: ComponentType): React.ComponentType<DynamicValue> | undefined {
    return this.components.get(type)
  }

  /**
   * 检查组件是否已注册
   * @param type 组件类型
   * @returns 是否已注册
   */
  has(type: ComponentType): boolean {
    return this.components.has(type)
  }

  /**
   * 列出所有已注册的组件类型
   * @returns 组件类型数组
   */
  listRegistered(): ComponentType[] {
    return Array.from(this.components.keys())
  }

  /**
   * 注销组件
   * @param type 组件类型
   */
  unregister(type: ComponentType): void {
    this.components.delete(type)
  }

  /**
   * 清空所有注册的组件
   */
  clear(): void {
    this.components.clear()
  }
}

/**
 * 导出单例实例
 */
export const componentRegistry = new ComponentRegistry()
