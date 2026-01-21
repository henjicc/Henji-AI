/**
 * 面板配置验证
 *
 * 验证面板配置的有效性
 */

import type { SpecialPanelConfig, PanelType } from '@/core/types/PanelTypes'

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * 验证面板配置
 * @param config 面板配置
 * @returns 验证结果
 */
export function validatePanelConfig(config: SpecialPanelConfig): ValidationResult {
  const errors: string[] = []

  // 验证必需字段
  if (!config.type) {
    errors.push('Panel type is required')
  }

  if (!config.label) {
    errors.push('Panel label is required')
  }

  if (!config.onChange || typeof config.onChange !== 'function') {
    errors.push('Panel onChange callback is required and must be a function')
  }

  // 验证面板类型特定配置
  if (config.type === 'resolution' && !config.config) {
    errors.push('Resolution panel requires config')
  }

  if (config.type === 'voice-selector' && !config.config) {
    errors.push('Voice selector panel requires config')
  }

  if (config.type === 'composite' && !config.config) {
    errors.push('Composite panel requires config')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * 验证面板类型是否有效
 * @param type 面板类型
 * @returns 是否有效
 */
export function isValidPanelType(type: string): type is PanelType {
  const validTypes: PanelType[] = [
    'resolution',
    'model-selector',
    'voice-selector',
    'style-gallery',
    'color-picker',
    'composite',
    'custom'
  ]
  return validTypes.includes(type as PanelType)
}
