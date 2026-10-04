import { LinkageEngine } from '@/core/linkage'
import type { ParamDef } from '@/core/types'
import { evaluateCondition } from '@/core/validation/conditionEvaluator'

type ParamValueMap = DynamicValueMap

function asRuntimeParams(values: ParamValueMap): DynamicValueMap {
  return values as DynamicValueMap
}

export function isParamVisible(
  param: ParamDef,
  values: ParamValueMap,
  linkageEngine: LinkageEngine | null
): boolean {
  const runtimeParams = asRuntimeParams(values)

  if (param.visible && !evaluateCondition(param.visible.condition, runtimeParams)) {
    return false
  }

  if (linkageEngine?.isParamHidden(param.id, runtimeParams)) {
    return false
  }

  return true
}

export function isParamDisabled(
  param: ParamDef,
  values: ParamValueMap,
  linkageEngine: LinkageEngine | null
): boolean {
  const runtimeParams = asRuntimeParams(values)

  if (param.disabled && evaluateCondition(param.disabled.condition, runtimeParams)) {
    return true
  }

  if (linkageEngine?.isParamDisabled(param.id, runtimeParams)) {
    return true
  }

  return false
}

function isSameAsDefault(value: DynamicValue, defaultValue: DynamicValue): boolean {
  if (Object.is(value, defaultValue)) return true
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null || typeof defaultValue !== 'object' || defaultValue === null) {
    return false
  }
  return JSON.stringify(value) === JSON.stringify(defaultValue)
}

/** 与默认值不同的参数个数（参数组摘要、生成底栏“更多参数”触发器共用）。 */
export function countChangedParams(params: ParamDef[], values: ParamValueMap): number {
  return params.reduce((count, param) => (
    isSameAsDefault(values[param.id], param.default) ? count : count + 1
  ), 0)
}

function isEmptyParamValue(value: DynamicValue): boolean {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
}

/**
 * 必填却没填的可见参数（按渲染顺序）。未写入的值回退到 schema 默认值。
 * 生成底栏据此在“更多参数”触发器上提示“需填写”，并在点生成时定位到该参数（任务 4.3）。
 */
export function findMissingRequiredParams(
  params: ParamDef[],
  values: ParamValueMap,
  linkageEngine: LinkageEngine | null,
): ParamDef[] {
  return params.filter((param) => (
    param.required === true
    && isParamVisible(param, values, linkageEngine)
    && isEmptyParamValue(values[param.id] ?? param.default)
  ))
}
