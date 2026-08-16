import type { AgentRunState } from '../../../src/core/assistant/events'

export interface AssistantCliAcceptance {
  passed: boolean
  status: AgentRunState['status']
  executionSealed: boolean
  effectCount: number
  verificationSummary: string
  presentationStatus: AgentRunState['presentationOutcome']['status']
  warningCode: string | null
  reasons: string[]
}

export function evaluateAssistantCliAcceptance(
  state: AgentRunState,
  requireVerifiedWrite: boolean,
  completedExternalEffects = 0,
): AssistantCliAcceptance {
  const successfulStatus = state.status === 'completed' || state.status === 'completed_with_warning'
  const executionSealed = state.executionOutcome.status === 'sealed_success' || completedExternalEffects > 0
  const effectCount = state.executionOutcome.effects.length + completedExternalEffects
  const externalVerification = completedExternalEffects > 0
    ? `已从正式生成任务状态确认 ${completedExternalEffects} 项外部写入完成。`
    : ''
  const verificationSummary = state.executionOutcome.verificationSummary.summary || externalVerification
  const hasVerification = verificationSummary.trim().length > 0
  const reasons: string[] = []
  if (!successfulStatus) reasons.push(`运行终态不是成功：${state.status}`)
  if (requireVerifiedWrite && !executionSealed) reasons.push('应用执行结果没有封存')
  if (requireVerifiedWrite && effectCount === 0) reasons.push('没有强类型应用 Effect Receipt')
  if (requireVerifiedWrite && !hasVerification) reasons.push('没有正式状态源的结构化验证摘要')
  return {
    passed: reasons.length === 0,
    status: state.status,
    executionSealed,
    effectCount,
    verificationSummary,
    presentationStatus: state.presentationOutcome.status,
    warningCode: state.presentationOutcome.warning?.code ?? null,
    reasons,
  }
}
