import type { AgentEvent } from './events'
import type { HostScopeRevisions } from './hostContracts'
import {
  agentWorkingSummarySchema,
  createAgentWorkingSummary,
  type AgentWorkingStep,
  type AgentWorkingSummary,
} from './workingContext'

/** 验证未通过留下的未收敛项前缀；通过时按它精确回收，不靠匹配文案内容。 */
export const VERIFICATION_FAILURE_PREFIX = '验证未通过：'

function appendBounded<T>(items: T[], value: T, limit: number): T[] {
  return [...items, value].slice(-limit)
}

function currentStep(event: Extract<AgentEvent, { type: 'ToolRequested' }>): AgentWorkingStep {
  return {
    stepId: event.toolCallId,
    title: event.title ?? event.toolName,
    status: 'active',
    toolName: event.toolName,
    toolCategory: event.category ?? null,
    readOnly: event.readOnly ?? null,
    idempotent: event.idempotent ?? null,
    summary: '',
    evidence: [],
    startedAt: event.occurredAt,
    completedAt: null,
  }
}

function completeActiveStep(
  summary: AgentWorkingSummary,
  event: Extract<AgentEvent, { type: 'ToolCompleted' }>
): AgentWorkingStep {
  const active = summary.activeStep
  return {
    stepId: event.toolCallId,
    title: active?.title ?? event.toolName,
    status: 'completed',
    toolName: event.toolName,
    toolCategory: event.category ?? active?.toolCategory ?? null,
    readOnly: event.readOnly ?? active?.readOnly ?? null,
    idempotent: event.idempotent ?? active?.idempotent ?? null,
    summary: event.summary,
    evidence: Object.entries(event.resultReferences ?? {}).map(([key, value]) => `${key}:${value}`),
    startedAt: active?.startedAt ?? event.occurredAt,
    completedAt: event.occurredAt,
  }
}

function failActiveStep(
  summary: AgentWorkingSummary,
  event: Extract<AgentEvent, { type: 'ToolFailed' }>
): AgentWorkingStep {
  const active = summary.activeStep
  return {
    stepId: event.toolCallId,
    title: active?.title ?? event.toolName,
    status: 'failed',
    toolName: event.toolName,
    toolCategory: event.category ?? active?.toolCategory ?? null,
    readOnly: event.readOnly ?? active?.readOnly ?? null,
    idempotent: event.idempotent ?? active?.idempotent ?? null,
    summary: `${event.error.code}: ${event.error.message}`,
    evidence: [`error:${event.error.code}`],
    startedAt: active?.startedAt ?? event.occurredAt,
    completedAt: event.occurredAt,
  }
}

export function reduceAgentWorkingSummary(
  current: AgentWorkingSummary | undefined,
  event: AgentEvent,
  scopeRevisions: HostScopeRevisions | null
): AgentWorkingSummary {
  const summary = current ?? createAgentWorkingSummary('未记录目标')
  let next: AgentWorkingSummary = { ...summary, scopeRevisions, updatedAt: event.occurredAt }

  if (event.type === 'PlanUpdated') {
    next = {
      ...next,
      route: {
        intent: event.intent,
        summary: event.summary,
        toolDomains: event.toolDomains,
        explicitUserIntent: event.explicitUserIntent,
      },
      planVersion: next.planVersion + 1,
    }
  } else if (event.type === 'ToolRequested') {
    next = { ...next, activeStep: currentStep(event) }
  } else if (event.type === 'ToolCompleted') {
    const step = completeActiveStep(next, event)
    const recoveredTool = next.recovery.toolName === event.toolName
    next = {
      ...next,
      activeStep: null,
      completedSteps: appendBounded(next.completedSteps, step, 20),
      evidence: appendBounded(next.evidence, {
        source: event.toolName,
        summary: event.summary,
        references: event.resultReferences ?? {},
        observedAt: event.occurredAt,
      }, 12),
      unresolvedItems: next.unresolvedItems.filter((item) => !item.includes(event.toolName)),
      recovery: recoveredTool ? {
        mode: 'none',
        reason: `${event.toolName} 已在后续调用中成功完成。`,
        toolName: null,
        toolCategory: null,
      } : next.recovery,
    }
  } else if (event.type === 'ToolFailed') {
    const step = failActiveStep(next, event)
    const unknownWrite = step.readOnly !== true
      && ['TIMEOUT', 'EXECUTION_FAILED', 'CANCELLED'].includes(event.error.code)
    next = {
      ...next,
      activeStep: null,
      failedSteps: appendBounded(next.failedSteps, step, 10),
      unresolvedItems: appendBounded(next.unresolvedItems, `${event.toolName} 未收敛：${event.error.code}`, 10),
      recovery: unknownWrite ? {
        mode: 'verify_before_write',
        reason: `${event.toolName} 的写入副作用未知，恢复后必须先查询真实状态。`,
        toolName: event.toolName,
        toolCategory: step.toolCategory,
      } : next.recovery,
    }
  } else if (event.type === 'ApprovalRequired') {
    next = {
      ...next,
      pendingApprovals: appendBounded(next.pendingApprovals, {
        approvalId: event.approval.approvalId,
        toolCallId: event.toolCallId,
        toolName: event.approval.toolName,
        expiresAt: event.approval.expiresAt,
      }, 4),
    }
  } else if (event.type === 'ApprovalResolved') {
    next = {
      ...next,
      pendingApprovals: next.pendingApprovals.filter((item) => item.approvalId !== event.approvalId),
    }
  } else if (event.type === 'ArtifactOffloaded') {
    next = { ...next, artifactRefs: appendBounded(next.artifactRefs, event.artifactRef, 12) }
  } else if (event.type === 'VerificationCompleted') {
    next = {
      ...next,
      evidence: event.passed
        ? appendBounded(next.evidence, {
            source: 'completion_verifier',
            summary: event.summary,
            references: Object.fromEntries(event.evidence.map((value, index) => [`evidence${index + 1}`, value])),
            observedAt: event.occurredAt,
          }, 12)
        : next.evidence,
      /*
       * 验证未通过留下的未收敛项，必须能被后来的一次通过验证清掉。
       *
       * 它不只是展示：`executionSealingBlocker` 见到非空 unresolvedItems 就拒绝封存。一条永远
       * 清不掉的旧记录等于整次运行再也封存不了。这里靠固定前缀标记出处——旧实现是拿正则去猜
       * 那句话长什么样（`/任务图仍有 \d+ 个 Facet 未结算/`），文案一改就失灵。
       */
      unresolvedItems: event.passed
        ? next.unresolvedItems.filter((item) => !item.startsWith(VERIFICATION_FAILURE_PREFIX))
        : appendBounded(
            next.unresolvedItems,
            `${VERIFICATION_FAILURE_PREFIX}${event.summary}`,
            10
          ),
    }
  } else if (event.type === 'ClarificationRequired') {
    next = {
      ...next,
      unresolvedItems: appendBounded(next.unresolvedItems, event.reason, 10),
      recovery: {
        mode: 'await_user',
        reason: event.question,
        toolName: null,
        toolCategory: null,
      },
    }
  }

  return agentWorkingSummarySchema.parse(next)
}
