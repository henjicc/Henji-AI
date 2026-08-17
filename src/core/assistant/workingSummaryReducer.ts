import type { AgentEvent } from './events'
import type { HostScopeRevisions } from './hostContracts'
import {
  AGENT_WORKING_EVIDENCE_SUMMARY_MAX,
  AGENT_WORKING_STEP_EVIDENCE_MAX,
  AGENT_WORKING_STEP_SUMMARY_MAX,
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

/**
 * 截断到 schema 允许的长度，**保头保尾**。
 *
 * 不能简单地砍尾巴：一条可自纠的拒绝里，开头是"哪里错了"，结尾是"怎么改道"
 * （`……确实需要别的，就重新调用 discover_application_capabilities`），中间才是那串可用清单。
 * 砍尾等于把出路砍掉，模型拿到半句话只会继续撞墙——那正是这条规则最初要解决的问题。
 * 所以省略中间，两端都留住。
 *
 * 为什么必须在这里截而不是靠 schema 校验兜底：校验失败会抛 ZodError，而这段代码跑在
 * 构造工作摘要的路径上，抛出来就是整次运行 RunFailed——连 `ToolFailed` 事件都发不出去。
 * 实测 camera_stage 写错属性时就是这样：拒绝消息要列出 24 项外观属性，超过 1000 字符，
 * 一次本该可自纠的工具拒绝直接把运行打死。
 */
function boundedText(value: string, max: number): string {
  if (value.length <= max) return value
  const marker = `…（略去 ${value.length - max} 字）…`
  const keep = Math.max(0, max - marker.length)
  const head = Math.ceil(keep * 0.6)
  return `${value.slice(0, head)}${marker}${value.slice(value.length - (keep - head))}`
}

function boundedStepSummary(value: string): string {
  return boundedText(value, AGENT_WORKING_STEP_SUMMARY_MAX)
}

function boundedEvidenceSummary(value: string): string {
  return boundedText(value, AGENT_WORKING_EVIDENCE_SUMMARY_MAX)
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
    // ToolCompleted.summary 允许 2000 字符，这里只允许 1000——不截断的话，一次**成功**的
    // 工具调用只要摘要够长就能让整次运行 RunFailed。
    summary: boundedStepSummary(event.summary),
    evidence: Object.entries(event.resultReferences ?? {})
      .map(([key, value]) => boundedText(`${key}:${value}`, AGENT_WORKING_STEP_EVIDENCE_MAX)),
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
    summary: boundedStepSummary(`${event.error.code}: ${event.error.message}`),
    evidence: [boundedText(`error:${event.error.code}`, AGENT_WORKING_STEP_EVIDENCE_MAX)],
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
        summary: boundedEvidenceSummary(event.summary),
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
    /*
     * 只读调用失败不算"欠着事没做完"。
     *
     * `unresolvedItems` 不只是展示：`executionSealingBlocker` 见到它非空就拒绝封存，而清空
     * 的唯一途径是**同名工具**后来成功一次。模型读一次失败就换条路把活干完——它本来就该这么
     * 做——那条记录就再也清不掉。实测设置场景：一次 `read_agent_artifact` 报 NOT_FOUND，
     * 模型换路完成任务、12 项正式验证全过、10 个真实写入，却因为这条陈年记录拿不到封存，
     * 整次运行被判不通过。
     *
     * 只读失败世界没有变化、没有留下要收拾的东西，模型也已经用最终答复表明它认为做完了。
     * 失败本身照常进 failedSteps，模型看得到；只是不再拿它去否决模型的判断。
     * 写入失败照旧记账——那才是真的可能欠着东西。
     */
    next = {
      ...next,
      activeStep: null,
      failedSteps: appendBounded(next.failedSteps, step, 10),
      unresolvedItems: step.readOnly === true
        ? next.unresolvedItems
        : appendBounded(next.unresolvedItems, `${event.toolName} 未收敛：${event.error.code}`, 10),
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
