import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

/**
 * 还有什么拦着不让封存执行事实。返回 null 表示可以封存。
 *
 * 这里曾经有第一条 `settlement.status !== 'completed' → '任务图尚未完成'`：路由在模型动手
 * **之前**猜出一张 Facet 图，猜多了、猜错了域，运行就再也封存不了——用户要的东西明明做完
 * 并通过了正式状态源验证，最终却记成"未封存"。
 *
 * 现在的封存点是**模型自己决定收工**（不再调工具、给出最终答复）。剩下这四条全是事实判定：
 * 手上还有活、还有审批没批、恢复检查没做完、有明确记下的未收敛事项。它们说的都是"这次运行
 * 客观上还没停下来"，而不是"模型做得对不对"——后者由用户判断，不由运行时。
 */
export function executionSealingBlocker(input: {
  summary: AgentWorkingSummary | undefined
  effectCount: number
}): string | null {
  if (input.effectCount === 0) return '没有可封存的应用写入事实。'
  if (input.summary?.activeStep) return '仍有执行中的工具步骤。'
  if ((input.summary?.pendingApprovals.length ?? 0) > 0) return '仍有待处理的审批。'
  if (input.summary?.recovery.mode !== 'none') return input.summary?.recovery.reason || '恢复检查尚未完成。'
  if ((input.summary?.unresolvedItems.length ?? 0) > 0) {
    return `仍有未收敛事项：${input.summary?.unresolvedItems.join('；')}`
  }
  return null
}
