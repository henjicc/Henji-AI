import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentRouteDecision } from '../context/types'
import type { AgentRunMetrics } from './budget'

export function requireFinalResponseEvidence(input: {
  result: ModelStepResult
  route: AgentRouteDecision
  observationCount: number
  budget: AgentRunMetrics
  appendGuidance: (message: string) => void
}): string | null {
  const finalText = input.result.text.trim()
    || (input.result.structuredOutput ? JSON.stringify(input.result.structuredOutput) : '')
  if (finalText && (input.route.intent === 'general' || input.observationCount > 0)) return finalText
  input.budget.recordFailure()
  input.budget.recordProgress(`no-tool:${input.route.intent}:${input.result.finishReason}`)
  input.appendGuidance('尚无网关工具结果证明任务完成。请调用合适工具，或明确说明无法执行的原因。')
  return null
}
