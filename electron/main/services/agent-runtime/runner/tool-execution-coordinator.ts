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
 * 自己的低估值把它挡下来，只能重发一次——而计划内容与实际写入完全一致。（旧实现要求先走
 * declare_action_plan 声明协议，该协议已整体移除。）
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
    activeToolNames: ReadonlySet<string>,
    trustedInternalToolNames: ReadonlySet<string> = new Set(),
  ): Promise<void> {
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
      trustedInternalToolNames,
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
        if (call.toolName === 'run_henji_script') {
          const recoveryReason = this.options.recoveryGuard.validate(call)
          return recoveryReason ? rejectGuard(call, recoveryReason) : null
        }
        // 续跑调用不是模型提出的新写入，而是宿主对已在源运行中通过完整预检、已持久化 IR
        // 的确定性恢复。它的每个内部步骤仍会重新经过 Gateway、availability、权限和 revision
        // 校验；拿外层内部工具名再走 Task Graph 匹配，只会把合法断点误判为图外写入。
        if (call.toolName === 'resume_henji_script') return null
        if (currentTracker
          && !currentTracker.hasSufficientActionPlan(intendedWriteCalls)
          && this.options.registry.executionMetadata(call.toolName, call.input)?.readOnly === false) {
          return rejectGuard(call, {
            code: 'ACTION_PLAN_REQUIRED',
            // 出口只有一个：重写一段覆盖全部目标 Effect 的完整 Henji Script。
            // 旧文案让模型去调 declare_action_plan，而那个工具早已不在它的工具集里——
            // 一条执行不了的指引等于让模型原地卡死。
            reason: '该响应包含多项写入，但当前 Task Graph 没有足够的 Effect 数量；'
              + '请重新发现所需 scriptApi，并用一段覆盖全部目标 Effect 的完整 Henji Script 提交写入，不要拆成多次低层写入。',
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
      onOutcome: (call, observation, revisions) => {
        const failure = observationFailure(observation)
        const metadata = this.options.registry.executionMetadata(call.toolName, call.input)
        if (failure
          && metadata?.readOnly === false
          && ['TIMEOUT', 'EXECUTION_FAILED', 'CANCELLED'].includes(failure.code)) {
          this.options.recoveryGuard.activateUnknownWrite(call, metadata.category ?? null)
        }
        const tracker = this.options.getProgressTracker()
        if (!tracker) return
        const events = tracker.observe({ call, observation, expectedRevisions: revisions })
        this.options.onProgressUpdated?.()
        for (const event of [...events, ...tracker.drainPendingEvents()]) {
          this.options.emit(toAgentFacetProgressEvent(event))
        }
      },
    })
    try {
      // 授权位来自路由的显式判定，不再从 intent 字符串反推：intent 是给提示词与评测用的
      // 分类标签，把它当权限位用意味着标签取值一变，R1 写工具的自动放行范围就静默改变。
      await scheduler.execute(calls, route.explicitUserIntent, expectedRevisions)
    } finally {
      this.options.setActiveToolCall(null)
    }
  }
}
