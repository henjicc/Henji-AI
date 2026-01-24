import type { ConditionExpression, ConditionFunction } from '@/core/types'

export type ConditionInput = ConditionExpression | ConditionFunction | undefined

export function evaluateCondition(
  condition: ConditionInput,
  params: Record<string, any>,
  context: Record<string, any> = {}
): boolean {
  if (!condition) return true

  if (typeof condition === 'function') {
    try {
      return Boolean(condition(params))
    } catch (error) {
      console.error('[ConditionEvaluator] condition function error:', error)
      return false
    }
  }

  try {
    const fn = new Function(
      'params',
      'context',
      `with (params) { with (context) { return ${condition} } }`
    )
    return Boolean(fn(params, context))
  } catch (error) {
    console.error('[ConditionEvaluator] condition expression error:', error)
    console.error('[ConditionEvaluator] condition:', condition)
    return false
  }
}
