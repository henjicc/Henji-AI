import {
  evaluateRuntimeCondition,
  type JsonObject,
  type RuntimeConditionExpression,
  type RuntimeConditionFunction,
} from '@henjicc/ai-sdk'
import { createLogger } from '@/core/logging'
import type { ConditionExpression, ConditionFunction } from '@/core/types'

const logger = createLogger('core.validation.conditionEvaluator')

export type ConditionInput = ConditionExpression | ConditionFunction | undefined

export function evaluateCondition(
  condition: ConditionInput,
  params: DynamicValueMap,
  context: DynamicValueMap = {}
): boolean {
  if (!condition) return true

  try {
    return evaluateRuntimeCondition(
      condition as RuntimeConditionExpression | RuntimeConditionFunction | undefined,
      params as JsonObject,
      context as JsonObject
    )
  } catch (error) {
    logger.error('[ConditionEvaluator] condition evaluation error:', error)
    logger.error('[ConditionEvaluator] condition:', condition)
    return false
  }
}
