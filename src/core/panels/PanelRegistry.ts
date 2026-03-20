import { createLogger } from '@/core/logging'

const logger = createLogger('core.panels.PanelRegistry')
/**
 * PanelRegistry - 面板注册中心
 *
 * 管理所有特殊面板组件的注册和渲染
 */

import React from 'react'
import type { PanelType, SpecialPanelConfig } from '@/core/types/PanelTypes'

/**
 * 面板注册中心类
 */
class PanelRegistry {
  private panels: Map<PanelType, React.ComponentType<any>> = new Map()

  /**
   * 注册面板组件
   * @param type 面板类型
   * @param component 面板组件
   */
  register(type: PanelType, component: React.ComponentType<any>): void {
    if (this.panels.has(type)) {
      // 已注册则跳过（支持 React StrictMode 的双重调用）
      return
    }
    this.panels.set(type, component)
  }

  /**
   * 获取面板组件
   * @param type 面板类型
   * @returns 面板组件或 undefined
   */
  get(type: PanelType): React.ComponentType<any> | undefined {
    return this.panels.get(type)
  }

  /**
   * 检查面板是否已注册
   * @param type 面板类型
   * @returns 是否已注册
   */
  has(type: PanelType): boolean {
    return this.panels.has(type)
  }

  /**
   * 渲染面板
   * @param config 面板配置
   * @returns React 节点
   */
  render(config: SpecialPanelConfig): React.ReactNode {
    const Component = this.panels.get(config.type)

    if (!Component) {
      if (import.meta.env.DEV) {
        logger.error(`Unknown panel type: ${config.type}. Available panels:`, this.listRegistered())
      }
      return null
    }

    return React.createElement(Component, config)
  }

  /**
   * 列出所有已注册的面板类型
   * @returns 面板类型数组
   */
  listRegistered(): PanelType[] {
    return Array.from(this.panels.keys())
  }

  /**
   * 注销面板组件
   * @param type 面板类型
   */
  unregister(type: PanelType): void {
    this.panels.delete(type)
  }

  /**
   * 清空所有注册的面板
   */
  clear(): void {
    this.panels.clear()
  }
}

/**
 * 导出单例实例
 */
export const panelRegistry = new PanelRegistry()

