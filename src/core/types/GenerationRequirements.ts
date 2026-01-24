import type { ConditionExpression, ConditionFunction } from './ConditionTypes'

export type RequirementCondition = ConditionExpression | ConditionFunction

export interface RequirementMessage {
  title: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

export interface RequirementCount {
  min?: number
  max?: number
  exact?: number
}

export interface GenerationRequirement {
  id?: string
  when?: RequirementCondition
  require?: {
    prompt?: boolean
    images?: RequirementCount
    videos?: RequirementCount
  }
  message: RequirementMessage
}
