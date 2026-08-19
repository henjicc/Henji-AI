export type LlmReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface LlmReasoningConfig {
  enabled: boolean
  effort: LlmReasoningEffort
}
