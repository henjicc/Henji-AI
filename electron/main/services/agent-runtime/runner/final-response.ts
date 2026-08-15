import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentRouteDecision } from '../context/types'
import type { AgentRunMetrics } from './budget'

/**
 * 挡住"一个工具都不调就编一段答复"。
 *
 * 只下发一次指引就放行：这条守卫原本会一直 `continue`，直到撞上无进展预算才终止。
 * 模型若认定自己无需工具（例如它已经从上下文得出结论），反复顶回去只是把同一句话
 * 重说 N 遍，每遍都是一次完整的模型请求。提醒一次就够，之后是否可信交给用户判断。
 */
export function requireFinalResponseEvidence(input: {
  result: ModelStepResult
  route: AgentRouteDecision
  observationCount: number
  budget: AgentRunMetrics
  appendGuidance: (message: string) => void
  /** 本次运行是否已经下发过这条指引。 */
  alreadyGuided: boolean
}): string | null {
  const finalText = input.result.text.trim()
    || (input.result.structuredOutput ? JSON.stringify(input.result.structuredOutput) : '')
  if (finalText && (input.route.intent === 'general' || input.observationCount > 0)) return finalText
  if (input.alreadyGuided) return finalText || null
  input.budget.recordFailure()
  input.budget.recordProgress(`no-tool:${input.route.intent}:${input.result.finishReason}`)
  input.appendGuidance('尚无网关工具结果证明任务完成。请调用合适工具，或明确说明无法执行的原因。')
  return null
}
