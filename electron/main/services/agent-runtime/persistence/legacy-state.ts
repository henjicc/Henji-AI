import { agentRunStateSchema, type AgentRunState } from '../../../../../src/core/assistant/events'
import { createInitialAgentRunState } from '../runner/initial-state'
import { agentWorkingSummarySchema } from '../../../../../src/core/assistant/workingContext'

export const LEGACY_REVIEW_MESSAGE = '历史运行缺少当前协议的精确恢复证据，实际结果需要核对；不会自动重放旧操作。'

/** 只读投影；数据库中的原始状态、事件与检查点仍完整保留。 */
export function projectLegacyRunState(raw: unknown, identity: {
  runId: string; threadId: string; goal: string; createdAt: number; updatedAt: number
}): AgentRunState {
  const previous = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const base = createInitialAgentRunState(identity.runId, identity)
  const projected: Record<string, unknown> = { ...base }
  // 独立保留仍满足公开契约的字段，不解释已撤销的任务图或执行账本。
  for (const [key, schema] of Object.entries(agentRunStateSchema.shape)) {
    if (!(key in previous)) continue
    const parsed = schema.safeParse(previous[key])
    if (parsed.success) projected[key] = parsed.data
  }
  const oldSummary = previous.workingSummary && typeof previous.workingSummary === 'object'
    ? previous.workingSummary as Record<string, unknown> : {}
  const summaryFields: Record<string, unknown> = { ...base.workingSummary }
  for (const [key, schema] of Object.entries(agentWorkingSummarySchema.shape)) {
    if (!(key in oldSummary)) continue
    const parsed = schema.safeParse(oldSummary[key])
    if (parsed.success) summaryFields[key] = parsed.data
  }
  const workingSummary = agentWorkingSummarySchema.parse(summaryFields)
  return agentRunStateSchema.parse({
    ...projected, runId: identity.runId, threadId: identity.threadId,
    schemaVersion: base.schemaVersion, status: 'failed',
    startedAt: new Date(identity.createdAt).toISOString(), updatedAt: new Date(identity.updatedAt).toISOString(),
    currentStepId: null, currentToolCallId: null, waitingApprovalId: null, waitingClarificationId: null,
    error: { code: 'CHECKPOINT_VERSION_MISMATCH', message: LEGACY_REVIEW_MESSAGE, retryable: true, recovery: 'user_action' },
    executionOutcome: { ...base.executionOutcome,
      effects: agentRunStateSchema.shape.executionOutcome.safeParse(previous.executionOutcome).data?.effects ?? [],
      verificationSummary: { summary: LEGACY_REVIEW_MESSAGE, evidence: [] } },
    workingSummary: { ...workingSummary, pendingApprovals: [],
      unresolvedItems: [...new Set([...workingSummary.unresolvedItems, LEGACY_REVIEW_MESSAGE])],
      recovery: { mode: 'verify_before_write', reason: LEGACY_REVIEW_MESSAGE, toolName: null, toolCategory: null } },
  })
}
