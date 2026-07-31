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
  recordToolCall: (signature: string) => void
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
}

export class AgentToolExecutionCoordinator {
  constructor(private readonly options: AgentToolExecutionCoordinatorOptions) {}

  async execute(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>,
    activeToolNames: ReadonlySet<string>
  ): Promise<void> {
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
      executionGuard: (call) => this.options.recoveryGuard.validate(call),
    })
    try {
      await scheduler.execute(calls, route.intent !== 'general', expectedRevisions)
    } finally {
      this.options.setActiveToolCall(null)
    }
  }
}
