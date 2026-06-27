/**
 * Input limits configuration.
 */

import type { ConditionExpression, ConditionFunction } from './ConditionTypes'

export type InputCondition = ConditionExpression | ConditionFunction

export interface InputCountLimit {
  min?: number
  max?: number
  exact?: number
}

export interface VideoConstraints {
  maxSizeMB?: number
  minDurationSec?: number
  maxDurationSec?: number
}

export interface InputLimitRule {
  when?: InputCondition
  images?: InputCountLimit
  videos?: InputCountLimit
  audios?: InputCountLimit
  videoConstraints?: VideoConstraints
}

export interface InputLimitsConfig {
  images?: InputCountLimit
  videos?: InputCountLimit
  audios?: InputCountLimit
  rules?: InputLimitRule[]
}

export type InputLimitsResolver = (params: DynamicValueMap) => InputLimitsConfig

export type InputLimits = InputLimitsConfig | InputLimitsResolver
