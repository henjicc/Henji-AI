import type { AgentProgressSettlement } from '../../../../../src/core/assistant/progress'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

export function executionSealingBlocker(input: {
  settlement: AgentProgressSettlement | undefined
  summary: AgentWorkingSummary | undefined
  effectCount: number
}): string | null {
  if (input.settlement?.status !== 'completed') return '任务图尚未完成。'
  if (input.effectCount === 0) return '没有可封存的应用写入事实。'
  if (input.summary?.activeStep) return '仍有执行中的工具步骤。'
  if ((input.summary?.pendingApprovals.length ?? 0) > 0) return '仍有待处理的审批。'
  if (input.summary?.recovery.mode !== 'none') return input.summary?.recovery.reason || '恢复检查尚未完成。'
  if ((input.summary?.unresolvedItems.length ?? 0) > 0) {
    return `仍有未收敛事项：${input.summary?.unresolvedItems.join('；')}`
  }
  return null
}
