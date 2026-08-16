import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import {
  agentWorkingSummarySchema,
  type AgentWorkingSummary,
} from '../../../../../src/core/assistant/workingContext'

export { reduceAgentWorkingSummary } from '../../../../../src/core/assistant/workingSummaryReducer'

function appendBounded<T>(items: T[], value: T, limit: number): T[] {
  return [...items, value].slice(-limit)
}

export function assessInterruptedWorkingSummary(
  current: AgentWorkingSummary
): AgentWorkingSummary {
  const now = new Date().toISOString()
  if (current.pendingApprovals.length > 0) {
    return agentWorkingSummarySchema.parse({
      ...current,
      pendingApprovals: [],
      unresolvedItems: appendBounded(current.unresolvedItems, '重启前的审批已经失效，需要重新规划。', 10),
      recovery: {
        mode: 'await_user',
        reason: '应用退出时仍有待审批操作；旧审批不可复用。',
        toolName: current.activeStep?.toolName ?? null,
        toolCategory: current.activeStep?.toolCategory ?? null,
      },
      updatedAt: now,
    })
  }
  if (current.activeStep) {
    const readOnly = current.activeStep.readOnly === true
    return agentWorkingSummarySchema.parse({
      ...current,
      unresolvedItems: appendBounded(
        current.unresolvedItems,
        `${current.activeStep.toolName ?? '活动步骤'} 在退出时未收敛。`,
        10
      ),
      recovery: {
        mode: readOnly ? 'resume_read_only' : 'verify_before_write',
        reason: readOnly
          ? '未完成步骤为只读操作，可在用户重试后重新查询。'
          : '未完成步骤可能有写入副作用，恢复后必须先查询真实状态。',
        toolName: current.activeStep.toolName,
        toolCategory: current.activeStep.toolCategory,
      },
      activeStep: null,
      updatedAt: now,
    })
  }
  return agentWorkingSummarySchema.parse({
    ...current,
    recovery: {
      mode: 'resume_read_only',
      reason: '退出时没有未收敛工具；用户重试后可从结构化摘要继续。',
      toolName: null,
      toolCategory: null,
    },
    updatedAt: now,
  })
}

export function markWorkingSummaryRecoveryVerified(
  current: AgentWorkingSummary
): AgentWorkingSummary {
  return agentWorkingSummarySchema.parse({
    ...current,
    unresolvedItems: current.unresolvedItems.filter((item) => (
      !item.includes('未收敛')
      && !item.startsWith('恢复时宿主作用域已变化：')
    )),
    recovery: {
      mode: 'none',
      reason: '已通过同领域只读工具重新确认状态。',
      toolName: null,
      toolCategory: null,
    },
    updatedAt: new Date().toISOString(),
  })
}

export function prepareWorkingSummaryForRetry(
  current: AgentWorkingSummary,
  currentScopeRevisions: HostScopeRevisions,
  availableArtifactRefs: string[]
): AgentWorkingSummary {
  const changedScopes = current.scopeRevisions
    ? Object.entries(currentScopeRevisions).flatMap(([scope, revision]) => (
        current.scopeRevisions?.[scope as keyof HostScopeRevisions] === revision ? [] : [scope]
      ))
    : []
  const missingArtifacts = current.artifactRefs.filter((ref) => !availableArtifactRefs.includes(ref))
  const unresolvedItems = [
    ...current.unresolvedItems,
    ...(changedScopes.length > 0
      ? [`恢复时宿主作用域已变化：${changedScopes.join(', ')}；后续工具必须使用新 revision。`]
      : []),
    ...(missingArtifacts.length > 0
      ? [`${missingArtifacts.length} 个历史产物引用已不可用，不得据此声称已验证。`]
      : []),
  ].slice(-10)
  return agentWorkingSummarySchema.parse({
    ...current,
    scopeRevisions: currentScopeRevisions,
    artifactRefs: availableArtifactRefs.slice(-12),
    pendingApprovals: [],
    unresolvedItems,
    recovery: changedScopes.length > 0 && current.recovery.mode === 'none'
      ? {
          mode: 'resume_read_only',
          reason: '宿主 revision 已变化，恢复后先重新读取状态。',
          toolName: null,
          toolCategory: null,
        }
      : current.recovery,
    updatedAt: new Date().toISOString(),
  })
}
