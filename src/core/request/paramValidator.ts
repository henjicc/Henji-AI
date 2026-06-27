/**
 * 参数验证器
 *
 * 验证参数值是否符合模型定义的要求
 */

import type { ParamDef } from '../types'
import { getI18nText } from '../types/I18nText'

/**
 * 验证错误接口
 */
export interface ValidationError {
  /**
   * 参数 ID
   */
  paramId: string

  /**
   * 错误消息
   */
  message: string

  /**
   * 错误类型
   */
  type: 'required' | 'type' | 'range' | 'options' | 'custom'
}

/**
 * 验证参数
 *
 * @param params - 参数对象
 * @param schema - 参数定义数组
 * @returns 验证错误数组（空数组表示验证通过）
 *
 * @example
 * ```typescript
 * const errors = validateParams(
 *   { quality: 'invalid', size: -1 },
 *   schema
 * )
 * // [
 * //   { paramId: 'quality', message: '...', type: 'options' },
 * //   { paramId: 'size', message: '...', type: 'range' }
 * // ]
 * ```
 */
export function validateParams(
  params: DynamicValueMap,
  schema: ParamDef[]
): ValidationError[] {
  const errors: ValidationError[] = []

  for (const paramDef of schema) {
    const value = params[paramDef.id]

    // 1. 检查必需参数
    if ('required' in paramDef && paramDef.required) {
      if (value === undefined || value === null || value === '') {
        errors.push({
          paramId: paramDef.id,
          message: `${getParamName(paramDef)} is required`,
          type: 'required'
        })
        continue
      }
    }

    // 跳过未设置的可选参数
    if (value === undefined || value === null || value === '') {
      continue
    }

    // 2. 检查类型
    const typeError = validateType(paramDef, value)
    if (typeError) {
      errors.push(typeError)
      continue
    }

    // 3. 检查范围（number）
    const rangeError = validateRange(paramDef, value)
    if (rangeError) {
      errors.push(rangeError)
    }

    // 4. 检查选项（dropdown/radio）
    const optionsError = validateOptions(paramDef, value)
    if (optionsError) {
      errors.push(optionsError)
    }

    // 5. 检查数组长度（upload 组件）
    const lengthError = validateArrayLength(paramDef, value)
    if (lengthError) {
      errors.push(lengthError)
    }
  }

  return errors
}

/**
 * 验证单个参数值
 *
 * @param paramDef - 参数定义
 * @param value - 参数值
 * @returns 是否有效
 */
export function validateParamValue(paramDef: ParamDef, value: DynamicValue): boolean {
  // 必需参数检查
  if ('required' in paramDef && paramDef.required) {
    if (value === undefined || value === null || value === '') {
      return false
    }
  }

  // 可选参数未设置时跳过
  if (value === undefined || value === null || value === '') {
    return true
  }

  // 类型检查
  if (!isValidType(paramDef, value)) {
    return false
  }

  // 范围检查
  if (!isValidRange(paramDef, value)) {
    return false
  }

  // 选项检查
  if (!isValidOption(paramDef, value)) {
    return false
  }

  // 数组长度检查
  if (!isValidArrayLength(paramDef, value)) {
    return false
  }

  return true
}

/**
 * 验证类型
 */
function validateType(paramDef: ParamDef, value: DynamicValue): ValidationError | null {
  if (!isValidType(paramDef, value)) {
    return {
      paramId: paramDef.id,
      message: `${getParamName(paramDef)} must be a ${paramDef.valueType}`,
      type: 'type'
    }
  }
  return null
}

/**
 * 检查类型是否有效
 */
function isValidType(paramDef: ParamDef, value: DynamicValue): boolean {
  const expectedType = paramDef.valueType
  const actualType = typeof value

  switch (expectedType) {
    case 'number':
      return actualType === 'number' && !isNaN(value)
    case 'boolean':
      return actualType === 'boolean'
    case 'string':
      return actualType === 'string'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return actualType === 'object' && value !== null && !Array.isArray(value)
    default:
      return true
  }
}

/**
 * 验证范围
 */
function validateRange(paramDef: ParamDef, value: DynamicValue): ValidationError | null {
  if (!isValidRange(paramDef, value)) {
    const min = 'min' in paramDef ? paramDef.min : undefined
    const max = 'max' in paramDef ? paramDef.max : undefined

    let message = `${getParamName(paramDef)} is out of range`
    if (min !== undefined && max !== undefined) {
      message = `${getParamName(paramDef)} must be between ${min} and ${max}`
    } else if (min !== undefined) {
      message = `${getParamName(paramDef)} must be >= ${min}`
    } else if (max !== undefined) {
      message = `${getParamName(paramDef)} must be <= ${max}`
    }

    return {
      paramId: paramDef.id,
      message,
      type: 'range'
    }
  }
  return null
}

/**
 * 检查范围是否有效
 */
function isValidRange(paramDef: ParamDef, value: DynamicValue): boolean {
  if (typeof value !== 'number') {
    return true
  }

  if ('min' in paramDef && paramDef.min !== undefined && value < paramDef.min) {
    return false
  }

  if ('max' in paramDef && paramDef.max !== undefined && value > paramDef.max) {
    return false
  }

  return true
}

/**
 * 验证选项
 */
function validateOptions(paramDef: ParamDef, value: DynamicValue): ValidationError | null {
  if (!isValidOption(paramDef, value)) {
    const validValues =
      'options' in paramDef && paramDef.options
        ? paramDef.options.map((o) => o.value).join(', ')
        : ''

    return {
      paramId: paramDef.id,
      message: `${getParamName(paramDef)} must be one of: ${validValues}`,
      type: 'options'
    }
  }
  return null
}

/**
 * 检查选项是否有效
 */
function isValidOption(paramDef: ParamDef, value: DynamicValue): boolean {
  if (!('options' in paramDef) || !paramDef.options) {
    return true
  }

  const validValues = paramDef.options.map((o) => o.value)
  return validValues.includes(value)
}

/**
 * 验证数组长度
 */
function validateArrayLength(paramDef: ParamDef, value: DynamicValue): ValidationError | null {
  if (!isValidArrayLength(paramDef, value)) {
    const maxCount = 'maxCount' in paramDef ? paramDef.maxCount : undefined

    return {
      paramId: paramDef.id,
      message: `${getParamName(paramDef)} can have at most ${maxCount} items`,
      type: 'range'
    }
  }
  return null
}

/**
 * 检查数组长度是否有效
 */
function isValidArrayLength(paramDef: ParamDef, value: DynamicValue): boolean {
  if (!Array.isArray(value)) {
    return true
  }

  if ('maxCount' in paramDef && paramDef.maxCount !== undefined) {
    return value.length <= paramDef.maxCount
  }

  return true
}

/**
 * 获取参数显示名称
 */
function getParamName(paramDef: ParamDef): string {
  return getI18nText(paramDef.name, 'zh') || paramDef.id
}
