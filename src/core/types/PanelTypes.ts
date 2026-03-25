/**
 * 面板类型定义
 *
 * 定义特殊面板的类型和配置接口
 */

import type { I18nText } from './I18nText'

/**
 * 面板类型枚举
 */
export type PanelType =
  | 'resolution'        // 分辨率面板
  | 'model-selector'    // 模型选择面板
  | 'modelscope-custom-model' // ModelScope 自定义模型面板
  | 'voice-selector'    // 音色选择面板
  | 'minimax-voice-clone' // MiniMax 音色克隆面板
  | 'style-gallery'     // 风格画廊面板
  | 'color-picker'      // 颜色选择器面板
  | 'composite'         // 组合面板
  | 'custom'            // 自定义面板

/**
 * 面板触发器样式
 */
export type TriggerStyle = 'button' | 'input' | 'card'

/**
 * 面板对齐方式
 */
export type PanelAlignment = 'above' | 'below' | 'left' | 'right' | 'center'

/**
 * 分辨率面板配置
 */
export interface ResolutionPanelConfig {
  mode: 'aspect-quality' | 'width-height' | 'preset'
  aspectRatios?: string[]
  qualityTiers?: string[]
  presets?: Array<{
    label: I18nText
    width: number
    height: number
  }>
}

/**
 * 音色选择面板配置
 */
export interface VoiceSelectorConfig {
  voices: Array<{
    id: string
    name: I18nText
    description?: I18nText
    preview?: string
    tags?: string[]
  }>
  showPreview?: boolean
  allowSearch?: boolean
  voiceLibrary?: {
    providerId: string
    modelId?: string
    allowDelete?: boolean
  }
}

/**
 * MiniMax 音色克隆面板配置
 */
export interface MinimaxVoiceClonePanelConfig {
  providerId?: string
  modelId?: string
  previewModels?: Array<{
    value: string
    label: string
  }>
}

/**
 * 组合面板配置
 */
export interface CompositePanelConfig {
  panels: Array<{
    type: PanelType
    config: any
  }>
  layout?: 'horizontal' | 'vertical' | 'grid'
}

/**
 * 自定义面板配置
 */
export interface CustomPanelConfig {
  [key: string]: any
}

/**
 * 特殊面板配置
 */
export interface SpecialPanelConfig {
  /** 面板类型 */
  type: PanelType

  /** 面板标签 */
  label: I18nText

  /** 面板宽度（像素） */
  width?: number

  /** 面板对齐方式 */
  alignment?: PanelAlignment

  /** 点击面板内部是否关闭 */
  closeOnPanelClick?: boolean

  /** 触发器样式 */
  triggerStyle?: TriggerStyle

  /** 触发器显示函数 */
  triggerDisplay?: (value: any) => string

  /** 面板特定配置 */
  config: ResolutionPanelConfig | VoiceSelectorConfig | MinimaxVoiceClonePanelConfig | CompositePanelConfig | CustomPanelConfig

  /** 当前值 */
  value: any

  /** 值变化回调 */
  onChange: (value: any) => void

  /** 显示条件 */
  showWhen?: (params: Record<string, any>) => boolean

  /** 禁用条件 */
  disabled?: (params: Record<string, any>) => boolean
}
