/**
 * 默认值提取器
 *
 * 从参数 Schema 中提取默认值
 */

import type { ParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'

const ASPECT_HINT_PATTERN = /(aspect|ratio|宽高比|比例)/i
const RATIO_VALUE_PATTERN = /^(\d+)\s*:\s*(\d+)$/
const SMART_VALUE_PATTERN = /^(smart|auto|adaptive|智能)$/i

function isChoiceParam(param: ParamDef): param is Extract<ParamDef, { type: 'dropdown' | 'radio' }> {
  return param.type === 'dropdown' || param.type === 'radio'
}

function isAspectLikeParam(param: Extract<ParamDef, { type: 'dropdown' | 'radio' }>): boolean {
  const searchText = [
    param.id,
    param.apiField,
    getI18nText(param.name, 'zh'),
    getI18nText(param.name, 'en'),
  ]
    .filter(Boolean)
    .join(' ')

  if (ASPECT_HINT_PATTERN.test(searchText)) {
    return true
  }

  const ratioLikeCount = param.options.reduce((count, option) => {
    const valueText = String(option.value || '').trim()
    const labelText = String(getI18nText(option.label, 'zh') || getI18nText(option.label, 'en') || '').trim()
    if (RATIO_VALUE_PATTERN.test(valueText) || RATIO_VALUE_PATTERN.test(labelText)) {
      return count + 1
    }
    return count
  }, 0)

  return ratioLikeCount >= 2
}

function getSmartOptionValue(
  param: Extract<ParamDef, { type: 'dropdown' | 'radio' }>
): string | number | null {
  const candidate = param.options.find((option) => SMART_VALUE_PATTERN.test(String(option.value).trim()))
  return candidate ? candidate.value : null
}

/**
 * 从参数 Schema 提取默认值
 *
 * @param schema - 参数定义数组
 * @returns 默认值对象
 *
 * @example
 * ```typescript
 * const schema = [
 *   { id: 'prompt', default: '', ... },
 *   { id: 'quality', default: 'standard', ... },
 *   { id: 'size', default: 1024, ... }
 * ]
 *
 * const defaults = extractDefaults(schema)
 * // { prompt: '', quality: 'standard', size: 1024 }
 * ```
 */
export function extractDefaults(schema: ParamDef[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}

  for (const param of schema) {
    if (param.default !== undefined) {
      defaults[param.id] = param.default
      continue
    }
    if (isChoiceParam(param) && isAspectLikeParam(param)) {
      const smartValue = getSmartOptionValue(param)
      defaults[param.id] = smartValue ?? 'smart'
      continue
    }
  }

  return defaults
}

/**
 * 验证参数值是否有效
 *
 * @param paramDef - 参数定义
 * @param value - 参数值
 * @returns 是否有效
 */
export function validateParamValue(paramDef: ParamDef, value: unknown): boolean {
  // 基础类型检查
  if (paramDef.valueType === 'string' && typeof value !== 'string') {
    return false
  }

  if (paramDef.valueType === 'number' && typeof value !== 'number') {
    return false
  }

  if (paramDef.valueType === 'boolean' && typeof value !== 'boolean') {
    return false
  }

  // 数值范围检查
  if (paramDef.type === 'number') {
    if (typeof value !== 'number') {
      return false
    }
    if ('min' in paramDef && paramDef.min !== undefined && value < paramDef.min) {
      return false
    }
    if ('max' in paramDef && paramDef.max !== undefined && value > paramDef.max) {
      return false
    }
  }

  // 选项检查
  if (paramDef.type === 'dropdown' || paramDef.type === 'radio') {
    if ('options' in paramDef && paramDef.options) {
      const validValues = paramDef.options.map((opt) => opt.value)
      if (validValues.some((validValue) => validValue === value)) {
        return true
      }

      if (isAspectLikeParam(paramDef) && SMART_VALUE_PATTERN.test(String(value).trim())) {
        return true
      }

      if (!validValues.some((validValue) => validValue === value)) {
        return false
      }
    }
  }

  return true
}

/**
 * 获取参数的显示名称
 *
 * @param paramDef - 参数定义
 * @param locale - 语言
 * @returns 显示名称
 */
export function getParamDisplayName(
  paramDef: ParamDef,
  locale: 'zh' | 'en' = 'zh'
): string {
  return getI18nText(paramDef.name, locale) || paramDef.id
}
