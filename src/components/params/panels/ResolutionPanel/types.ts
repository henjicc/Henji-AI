/**
 * ResolutionPanel 类型定义
 */

import type { I18nText } from '@/core/types'

/**
 * 分辨率模式
 */
export type ResolutionMode = 'aspect-quality' | 'preset' | 'custom' | 'hybrid'

/**
 * 比例选项
 */
export interface AspectRatioOption {
  value: string
  label: I18nText
  icon?: {
    width: number
    height: number
  }
}

/**
 * 质量档位选项
 */
export interface QualityOption {
  value: string
  label: I18nText
  resolution?: string
  description?: I18nText
}

/**
 * 预设分辨率选项
 */
export interface PresetOption {
  value: string
  label: I18nText
  width: number
  height: number
  aspectRatio?: string
}

/**
 * 分辨率配置
 */
export interface ResolutionConfig {
  mode: ResolutionMode

  // Mode A: 比例 + 质量
  aspectRatios?: {
    options: AspectRatioOption[]
    default: string
    smartMatch?: boolean
  }

  qualityTiers?: {
    options: QualityOption[]
    default: string
    availableFor?: Record<string, string[]>
  }

  // Mode B: 预设
  presets?: {
    options: PresetOption[]
    default: string
  }

  // Mode C: 自定义
  customSize?: {
    enabled: boolean
    minWidth: number
    maxWidth: number
    minHeight: number
    maxHeight: number
    step: number
    lockRatio?: boolean
  }
}

/**
 * 分辨率值
 */
export interface ResolutionValue {
  mode: ResolutionMode
  aspectRatio?: string
  quality?: string
  preset?: string
  width?: number
  height?: number
}
