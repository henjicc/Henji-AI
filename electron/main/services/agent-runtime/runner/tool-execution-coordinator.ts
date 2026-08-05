import type { AgentApprovalRequest, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolErrorCode, AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolCatalogPlanner } from '../context/catalog'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRecoveryWriteGuard } from './recovery-guard'
import {
  AgentToolCallScheduler,
  type AgentExecutionGuardRejection,
} from './tool-call-scheduler'
import type { AgentFacetProgress } from '../../../../../src/core/assistant/progress'
import type { AgentFacetProgressTracker } from './facet-progress'
import type { PreparedDeclaredActionPlan } from './facet-action-plan'
import { observationFailure } from './facet-effect-ledger'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

interface AgentToolExecutionCoordinatorOptions {
  runId: string
  threadId: string
  approvalMode: AgentApprovalMode
  supportsParallelTools: boolean
  gateway: AgentToolGateway
  registry: AgentToolRegistry
  catalogPlanner: AgentToolCatalogPlanner
  recoveryGuard: AgentRecoveryWriteGuard
  signal: AbortSignal
  waitIfPaused: () => Promise<void>
  throwIfCancelled: () => void
  recordToolCall: (signature: string, write: boolean) => void
  recordProgress: (signature: string) => void
  recordFailure: () => void
  recordSuccess: () => void
  setActiveToolCall: (toolCallId: string | null) => void
  requestApproval: (
    call: ModelStepToolCall,
    approval: AgentApprovalRequest
  ) => Promise<'approve' | 'reject' | 'expired'>
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  emit: (event: AgentEventInput) => void
  onDiscoveredTools: (toolCallId: string, toolNames: string[]) => void
  getProgressTracker: () => AgentFacetProgressTracker | null
  onProgressUpdated?: () => void
}

/**
 * 本轮响应里有几次**独立写入**——按调用数算，不按调用内部的条目数算。
 *
 * 这个数字只服务于"要不要先声明 action plan"的门禁，语义是"该响应包含多项写入"。一次
 * change_application_entities 是一个原子事务，无论它带 1 条还是 6 条 item 都只是一次写入；把
 * 内部条目摊开来数，等于要求任务图预先猜中模型会在一次批量里写几条。
 *
 * 实测这就是关键帧那一步每次必然多烧一轮的原因：确定性任务图给关键帧写死 minimumCount=1
 * （场景 Facet 会按物体数算，这里没有），模型一次提交 6 个关键帧被判成 6 次写入，运行时拿
 * 自己的低估值把它挡下来，只能先 declare_action_plan 再重发——而声明的内容与实际写入完全一致。
 *
 * 真实条目数仍由 resolveObservedEffects 计入 Effect Ledger，结算精度不受影响；单次批量的规模
 * 另有 collectionWrite.maxItemsPerChange 与写入预算兜底。
 */
function intendedWriteCallCount(call: ModelStepToolCall, registry: AgentToolRegistry): number {
  return registry.executionMetadata(call.toolName, call.input)?.readOnly === false ? 1 : 0
}

export function toAgentFacetProgressEvent(progress: AgentFacetProgress): AgentEventInput {
  return {
    type: 'FacetProgressed',
    facetId: progress.facetId,
    status: progress.status,
    progressKind: progress.kind,
    summary: progress.summary,
    evidence: progress.evidence,
    executionFingerprint: progress.executionFingerprint,
    blocker: progress.blocker,
  }
}

export class AgentToolExecutionCoordinator {
  /** 整次运行内已经纠正过的守卫问题，用来区分"第一次被纠正"和"重复犯同一个错"。 */
  private readonly rejectedGuardSignatures = new Set<string>()

  constructor(private readonly options: AgentToolExecutionCoordinatorOptions) {}

  async execute(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>,
    activeToolNames: ReadonlySet<string>
  ): Promise<void> {
    const pendingActionPlans = new Map<string, Extract<PreparedDeclaredActionPlan, { ok: true }>>()
    const committedActionPlans = new Set<string>()
    const rejectGuard = (
      call: ModelStepToolCall,
      decision: string | { code: AgentToolErrorCode; reason: string },
      issueCodes: string[] = []
    ): AgentExecutionGuardRejection => {
      const code = typeof decision === 'string' ? 'RECOVERY_VERIFICATION_REQUIRED' : decision.code
      const reason = typeof decision === 'string' ? decision : decision.reason
      // 同一工具 + 同一问题第一次出现时只算纠正；模型没听懂再犯才计入连续失败预算。
      const signature = `${call.toolName}:${code}:${issueCodes.join(',')}`
      const contractCorrection = !this.rejectedGuardSignatures.has(signature)
      this.rejectedGuardSignatures.add(signature)
      logger.warn('Agent Task Graph 执行守卫拒绝工具', {
        event: 'agent_task_graph.execution_guard.rejected',
        requestId: this.options.runId,
        taskId: call.toolCallId,
        context: {
          toolName: call.toolName,
          errorCode: code,
          frontierFacetIds: this.options.getProgressTracker()?.dependencyFrontierFacetIds() ?? [],
          issueCodes,
          contractCorrection,
        },
      })
      return { code, reason, contractCorrection }
    }
    const intendedWriteCalls = calls.reduce((count, call) => (
      count + intendedWriteCallCount(call, this.options.registry)
    ), 0)
    const scheduler = new AgentToolCallScheduler({
      runId: this.options.runId,
      threadId: this.options.threadId,
      approvalMode: this.options.approvalMode,
      supportsParallelTools: this.options.supportsParallelTools,
      gateway: this.options.gateway,
      registry: this.options.registry,
      catalogPlanner: this.options.catalogPlanner,
      activeToolNames,
      signal: this.options.signal,
      waitIfPaused: this.options.waitIfPaused,
      throwIfCancelled: this.options.throwIfCancelled,
      recordToolCall: this.options.recordToolCall,
      recordProgress: this.options.recordProgress,
      recordFailure: this.options.recordFailure,
      recordSuccess: this.options.recordSuccess,
      setActiveToolCall: this.options.setActiveToolCall,
      requestApproval: this.options.requestApproval,
      onObservation: this.options.onObservation,
      emit: this.options.emit,
      onDiscoveredTools: this.options.onDiscoveredTools,
      resolveActionGroup: (call) => this.options.getProgressTracker()?.actionGroupForCall(call) ?? null,
      normalizeInput: (call) => this.options.getProgressTracker()?.normalizeCallInput(call) ?? null,
      executionGuard: (call, revisions, allowSettledActionGroupSibling) => {
        const currentTracker = this.options.getProgressTracker()
        if (call.toolName === 'declare_action_plan') {
          logger.info('Agent Action Plan 声明校验开始', {
            event: 'agent_task_graph.action_plan.started',
            requestId: this.options.runId,
            taskId: call.toolCallId,
          })
          const prepared = currentTracker?.prepareDeclaredActionPlan(call.input)
          if (!prepared || !prepared.ok) {
            const issues = prepared && !prepared.ok ? prepared.issues : [{
              code: 'INVALID_TASK_GRAPH' as const,
              path: 'declaration',
              message: '当前运行没有可更新的 Task Graph',
            }]
            const reason = issues.map((issue) => `${issue.path}: ${issue.message}`).join('；').slice(0, 900)
            logger.warn('Agent Action Plan 声明校验失败', {
              event: 'agent_task_graph.action_plan.failed',
              requestId: this.options.runId,
              taskId: call.toolCallId,
              context: { issueCodes: issues.map((issue) => issue.code) },
            })
            return rejectGuard(call, { code: 'INVALID_INPUT', reason }, issues.map((issue) => issue.code))
          }
          pendingActionPlans.set(call.toolCallId, prepared)
        }
        if (currentTracker
          && !currentTracker.hasSufficientActionPlan(intendedWriteCalls)
          && this.options.registry.executionMetadata(call.toolName, call.input)?.readOnly === false) {
          return rejectGuard(call, {
            code: 'ACTION_PLAN_REQUIRED',
            reason: '该响应包含多项写入，但当前 Task Graph 没有足够的 Effect 数量；请先调用 declare_action_plan，再提交写入。',
          })
        }
        const recoveryReason = this.options.recoveryGuard.validate(call)
        if (recoveryReason) return rejectGuard(call, recoveryReason)
        const tracker = this.options.getProgressTracker()
        const decision = tracker?.validate(call, revisions, allowSettledActionGroupSibling)
        for (const event of [...(decision?.events ?? []), ...(tracker?.drainPendingEvents() ?? [])]) {
          this.options.emit(toAgentFacetProgressEvent(event))
        }
        return decision
          ? rejectGuard(
              call,
              { code: decision.code ?? 'RECOVERY_VERIFICATION_REQUIRED', reason: decision.reason },
              decision.issueCodes ?? []
            )
          : null
      },
      finalizeSuccessfulOutcome: (call) => {
        if (call.toolName !== 'declare_action_plan') return
        const tracker = this.options.getProgressTracker()
        const prepared = pendingActionPlans.get(call.toolCallId)
        if (!tracker || !prepared) throw new Error('ACTION_PLAN_PREPARATION_MISSING')
        tracker.commitDeclaredActionPlan(prepared)
        pendingActionPlans.delete(call.toolCallId)
        committedActionPlans.add(call.toolCallId)
      },
      onOutcome: (call, observation, revisions) => {
        const tracker = this.options.getProgressTracker()
        if (!tracker) return
        if (call.toolName === 'declare_action_plan') {
          const failure = observationFailure(observation)
          if (committedActionPlans.delete(call.toolCallId)) {
            route.taskGraph = tracker.taskGraphSnapshot()
            route.taskFacets = route.taskGraph.facets.map((facet) => facet.facetId)
            logger.info('Agent Action Plan 已原子提交', {
              event: 'agent_task_graph.action_plan.completed',
              requestId: this.options.runId,
              taskId: call.toolCallId,
              context: {
                facetIds: route.taskFacets,
                actionGroupCount: route.taskGraph.actionGroups.length,
              },
            })
            this.options.emit({
              type: 'PlanUpdated',
              intent: route.intent,
              summary: route.reason,
              toolDomains: route.toolDomains,
              taskGraph: route.taskGraph,
            })
          } else if (pendingActionPlans.delete(call.toolCallId)) {
            logger.warn('Agent Action Plan 执行失败，未提交候选任务图', {
              event: 'agent_task_graph.action_plan.failed',
              requestId: this.options.runId,
              taskId: call.toolCallId,
              context: { issueCodes: [failure?.code ?? 'EXECUTION_FAILED'] },
            })
          }
          this.options.onProgressUpdated?.()
          return
        }
        const events = tracker.observe({ call, observation, expectedRevisions: revisions })
        this.options.onProgressUpdated?.()
        for (const event of [...events, ...tracker.drainPendingEvents()]) {
          this.options.emit(toAgentFacetProgressEvent(event))
        }
      },
    })
    try {
      await scheduler.execute(calls, route.intent !== 'general', expectedRevisions)
    } finally {
      this.options.setActiveToolCall(null)
    }
  }
}
