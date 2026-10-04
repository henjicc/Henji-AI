/**
 * 分辨率类复合子组件（比例、质量档位、预设分辨率）的选项类型
 */

import type { I18nText } from '@/core/types'

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
