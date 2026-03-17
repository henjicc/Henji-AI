import { LinkageEngine } from '@/core/linkage'
import type { ParamDef } from '@/core/types'
import { evaluateCondition } from '@/core/validation/conditionEvaluator'

type ParamValueMap = Record<string, unknown>

function asRuntimeParams(values: ParamValueMap): Record<string, any> {
  return values as Record<string, any>
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
