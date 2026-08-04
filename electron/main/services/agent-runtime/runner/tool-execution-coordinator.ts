import type { AgentApprovalRequest, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolCatalogPlanner } from '../context/catalog'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRecoveryWriteGuard } from './recovery-guard'
import { AgentToolCallScheduler } from './tool-call-scheduler'
import type { AgentFacetProgress } from '../../../../../src/core/assistant/progress'
import type { AgentFacetProgressTracker } from './facet-progress'

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

function intendedWriteEffectCount(call: ModelStepToolCall, registry: AgentToolRegistry): number {
  if (registry.executionMetadata(call.toolName, call.input)?.readOnly !== false) return 0
  if (!call.input || typeof call.input !== 'object' || Array.isArray(call.input)) return 1
  const input = call.input as Record<string, unknown>
  if (Array.isArray(input.changes)) {
    return Math.max(1, input.changes.reduce((count, rawChange) => {
      if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) return count + 1
      const change = rawChange as Record<string, unknown>
      if (change.kind === 'create_items' && Array.isArray(change.items)) return count + Math.max(1, change.items.length)
      if (change.kind === 'remove_items' && Array.isArray(change.targets)) return count + Math.max(1, change.targets.length)
      return count + 1
    }, 0))
  }
  if (Array.isArray(input.operations)) return Math.max(1, input.operations.length)
  if (call.toolName === 'delete_canvas_nodes' && Array.isArray(input.nodeIds)) {
    return Math.max(1, input.nodeIds.length)
  }
  return 1
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
  constructor(private readonly options: AgentToolExecutionCoordinatorOptions) {}

  async execute(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>,
    activeToolNames: ReadonlySet<string>
  ): Promise<void> {
    const intendedWriteEffects = calls.reduce((count, call) => (
      count + intendedWriteEffectCount(call, this.options.registry)
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
      executionGuard: (call, revisions, allowSettledActionGroupSibling) => {
        const currentTracker = this.options.getProgressTracker()
        if (currentTracker
          && !currentTracker.hasSufficientActionPlan(intendedWriteEffects)
          && this.options.registry.executionMetadata(call.toolName, call.input)?.readOnly === false) {
          return {
            code: 'ACTION_PLAN_REQUIRED',
            reason: '该响应包含多项写入，但当前 Task Graph 没有足够的 Effect 数量；请先调用 declare_action_plan，再提交写入。',
          }
        }
        const recoveryReason = this.options.recoveryGuard.validate(call)
        if (recoveryReason) return recoveryReason
        const tracker = this.options.getProgressTracker()
        const decision = tracker?.validate(call, revisions, allowSettledActionGroupSibling)
        for (const event of [...(decision?.events ?? []), ...(tracker?.drainPendingEvents() ?? [])]) {
          this.options.emit(toAgentFacetProgressEvent(event))
        }
        return decision ? { code: decision.code ?? 'RECOVERY_VERIFICATION_REQUIRED', reason: decision.reason } : null
      },
      onOutcome: (call, observation, revisions) => {
        const tracker = this.options.getProgressTracker()
        if (!tracker) return
        const events = tracker.observe({ call, observation, expectedRevisions: revisions })
        this.options.onProgressUpdated?.()
        for (const event of [...events, ...tracker.drainPendingEvents()]) {
          this.options.emit(toAgentFacetProgressEvent(event))
        }
        if (call.toolName === 'declare_action_plan') {
          route.taskGraph = tracker.taskGraphSnapshot()
          route.taskFacets = route.taskGraph.facets.map((facet) => facet.facetId)
          this.options.emit({
            type: 'PlanUpdated',
            intent: route.intent,
            summary: route.reason,
            toolDomains: route.toolDomains,
            taskGraph: route.taskGraph,
          })
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
