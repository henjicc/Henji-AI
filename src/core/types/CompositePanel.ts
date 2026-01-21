/**
 * CompositePanel 类型定义
 *
 * 通用可组合面板系统，支持通过配置组合多个子组件
 */

import type { I18nText } from './I18nText'

/**
 * 组件类型
 */
export type ComponentType =
  | 'aspect-ratio'
  | 'quality-tier'
  | 'custom-size'
  | 'preset-resolution'
  | 'text-input'
  | 'number-input'
  | 'slider'
  | 'dropdown'
  | 'switch'
  | 'radio'

/**
 * 布局类型
 */
export type LayoutType = 'vertical' | 'horizontal' | 'grid'

/**
 * 联动效果类型
 */
export type LinkageEffect = 'filter' | 'reset' | 'update' | 'disable' | 'hide'

/**
 * 组件配置
 */
export interface ComponentConfig {
  /** 组件唯一标识 */
  id: string

  /** 组件类型 */
  type: ComponentType

  /** 组件标签 */
  label?: I18nText

  /** 组件特定配置 */
  config: any

  /** 显示条件 */
  showWhen?: (compositeValue: any) => boolean

  /** 禁用条件 */
  disabledWhen?: (compositeValue: any) => boolean
}

/**
 * 组件联动配置
 */
export interface ComponentLinkage {
  /** 源组件 ID */
  source: string

  /** 目标组件 ID */
  target: string

  /** 联动效果 */
  effect: LinkageEffect

  /** 联动处理函数 */
  handler: (sourceValue: any, targetConfig: any, compositeValue: any) => any
}

/**
 * CompositePanel 配置
 */
export interface CompositePanelConfig {
  /** 布局类型 */
  layout: LayoutType

  /** 组件间距（像素） */
  gap?: number

  /** 网格列数（仅 layout='grid' 时有效） */
  gridColumns?: number

  /** 子组件配置列表 */
  components: ComponentConfig[]

  /** 组件间联动配置 */
  linkages?: ComponentLinkage[]
}
