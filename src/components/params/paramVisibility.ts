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

/**
 * 按联动给参数套上当前可选的取值：下拉与单选过滤选项（filterOptions），数值收窄范围（filterRange）。
 * 生成页参数面板、画布节点与离线组合检查都用这一份，界面能选什么与检查按什么枚举才一致。
 */
export function applyLinkageFilters(param: ParamDef, values: ParamValueMap, schema: ParamDef[], linkageEngine: LinkageEngine | null): ParamDef {
  if (!linkageEngine) return param
  if (param.type === 'dropdown' || param.type === 'radio') {
    const options = linkageEngine.getFilteredOptions(param.id, asRuntimeParams(values), schema)
    return !options.length || options === param.options ? param : { ...param, options } as ParamDef
  }
  if (param.type === 'number') {
    const range = linkageEngine.getFilteredRange(param.id, asRuntimeParams(values), schema)
    if (!range || (range.min === param.min && range.max === param.max && range.step === param.step)) return param
    return { ...param, ...range }
  }
  return param
}

/**
 * 选项类参数只剩一个可选值、且当前值就是它时（通常是联动筛掉了其他值）没有可选的余地，界面不显示这一项。
 * 当前值还不是那个唯一选项时照常显示，用户能看到并改正，提交时不会报一个看不见的参数冲突。
 * 没有静态选项的下拉（选项运行时载入）不在此列。
 */
export function offersChoice(param: ParamDef, values: ParamValueMap): boolean {
  if (param.type !== 'dropdown' && param.type !== 'radio') return true
  if (param.options?.length !== 1) return true
  return String(param.options[0].value) !== String(values[param.id] ?? param.default)
}
