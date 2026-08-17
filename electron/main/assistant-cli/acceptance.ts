import type { AgentRunState } from '../../../src/core/assistant/events'
import { isMutatingEffect } from '../../../src/core/assistant/observedEffect'

export interface AssistantCliAcceptance {
  passed: boolean
  status: AgentRunState['status']
  executionSealed: boolean
  effectCount: number
  /** 其中真的改了世界的那些（create/update/delete/execute），不含 observe 与 navigate。 */
  mutationCount: number
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
  /*
   * `--require-verified-write` 必须只认真正的写入。
   *
   * 这里原先用 `effects.length`，而它包含 observe——于是一次**纯只读**的运行也能满足
   * "要求至少一项应用写入"。实测工具箱只读查询产生 14 条 observe Effect，验收照样通过，
   * 这条门禁等于不存在。判别收敛到 `isMutatingEffect`，与封存摘要共用同一把尺子。
   */
  const mutationCount = state.executionOutcome.effects.filter(isMutatingEffect).length
    + completedExternalEffects
  const externalVerification = completedExternalEffects > 0
    ? `已从正式生成任务状态确认 ${completedExternalEffects} 项外部写入完成。`
    : ''
  const verificationSummary = state.executionOutcome.verificationSummary.summary || externalVerification
  const hasVerification = verificationSummary.trim().length > 0
  const reasons: string[] = []
  if (!successfulStatus) reasons.push(`运行终态不是成功：${state.status}`)
  if (requireVerifiedWrite && !executionSealed) reasons.push('应用执行结果没有封存')
  if (requireVerifiedWrite && mutationCount === 0) {
    reasons.push(
      effectCount > 0
        ? `没有任何应用写入：${effectCount} 项 Effect 全是读取或导航观察`
        : '没有强类型应用 Effect Receipt'
    )
  }
  if (requireVerifiedWrite && !hasVerification) reasons.push('没有正式状态源的结构化验证摘要')
  return {
    passed: reasons.length === 0,
    status: state.status,
    executionSealed,
    effectCount,
    mutationCount,
    verificationSummary,
    presentationStatus: state.presentationOutcome.status,
    warningCode: state.presentationOutcome.warning?.code ?? null,
    reasons,
  }
}
