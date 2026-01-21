/**
 * 默认值提取器
 *
 * 从参数 Schema 中提取默认值
 */

import type { ParamDef } from '@/core/types'

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
export function extractDefaults(schema: ParamDef[]): Record<string, any> {
  const defaults: Record<string, any> = {}

  for (const param of schema) {
    if (param.default !== undefined) {
      defaults[param.id] = param.default
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
export function validateParamValue(paramDef: ParamDef, value: any): boolean {
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
  if (paramDef.component === 'slider' || paramDef.component === 'number') {
    if ('min' in paramDef && value < paramDef.min) {
      return false
    }
    if ('max' in paramDef && value > paramDef.max) {
      return false
    }
  }

  // 选项检查
  if (paramDef.component === 'dropdown' || paramDef.component === 'radio') {
    if ('options' in paramDef && paramDef.options) {
      const validValues = paramDef.options.map((opt) => opt.value)
      if (!validValues.includes(value)) {
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
  if (typeof paramDef.name === 'string') {
    return paramDef.name
  }

  return paramDef.name[locale] || paramDef.name.zh || paramDef.name.en || paramDef.id
}
