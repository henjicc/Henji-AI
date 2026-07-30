import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentExternalContinuation } from '../../../../../src/core/assistant/externalWait'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentContextBuildResult } from '../context/types'
import type { AgentToolActivationSnapshot } from '../context/tool-activation'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import type { AgentToolExecutionCoordinator } from './tool-execution-coordinator'

const QUERY_TOOL = 'get_generation_task'
const FORBIDDEN_TOOL = 'create_visible_generation_task'

interface AgentExternalContinuationCoordinatorOptions {
  continuation?: AgentExternalContinuation
  registry: AgentToolRegistry
  tools: AgentToolExecutionCoordinator
  savePoints: AgentSavePointCoordinator
}

export class AgentExternalContinuationCoordinator {
  private queried = false

  constructor(private readonly options: AgentExternalContinuationCoordinatorOptions) {}

  emitResumed(emit: (event: AgentEventInput) => void): void {
    const continuation = this.options.continuation
    if (!continuation) return
    if (!['success', 'error', 'cancelled', 'timeout'].includes(continuation.observedStatus)) {
      throw new Error('[EXTERNAL_CONTINUATION_STATUS_INVALID] 自动续接必须来自终态')
    }
    emit({
      type: 'ExternalWaitResumed',
      waitId: continuation.waitId,
      taskId: continuation.taskId,
      status: continuation.observedStatus as 'success' | 'error' | 'cancelled' | 'timeout',
      sourceRunId: continuation.sourceRunId,
      sourceTotalTokens: continuation.sourceTotalTokens,
      sourceKnownCostUsd: continuation.sourceKnownCostUsd,
    })
  }

  extendActivation(
    activation: AgentToolActivationSnapshot,
    context: Parameters<AgentToolRegistry['registrations']>[1]
  ): AgentToolActivationSnapshot {
    if (!this.options.continuation) return activation
    const retained = activation.registrations.filter((item) => item.catalog.name !== FORBIDDEN_TOOL)
    const query = this.options.registry.registrations([QUERY_TOOL], context)[0]
    const registrations = query && !retained.some((item) => item.catalog.name === QUERY_TOOL)
      ? [...retained, query]
      : retained
    return {
      ...activation,
      registrations,
      activeToolNames: registrations.map((item) => item.catalog.name),
    }
  }

  async queryAuthoritativeStatus(input: {
    snapshot: AgentTurnSnapshotDraft
    route: AgentRouteDecision
    scopeRevisions: HostScopeRevisions
    activeToolNames: string[]
    rebuild: () => AgentContextBuildResult
  }): Promise<AgentContextBuildResult | null> {
    const continuation = this.options.continuation
    if (!continuation || this.queried) return null
    this.queried = true
    const call: ModelStepToolCall = {
      toolCallId: `external:${continuation.waitId}:query`,
      toolName: QUERY_TOOL,
      input: { taskId: continuation.taskId },
      dynamic: false,
    }
    await this.options.savePoints.save('before_tools', input.snapshot)
    await this.options.tools.execute(
      [call],
      input.route,
      input.scopeRevisions,
      new Set([...input.activeToolNames, QUERY_TOOL])
    )
    await this.options.savePoints.save('after_tools', input.snapshot)
    return input.rebuild()
  }

  assertNoResubmit(toolCalls: ModelStepToolCall[]): void {
    if (!this.options.continuation) return
    if (toolCalls.some((call) => call.toolName === FORBIDDEN_TOOL)) {
      throw new Error('[EXTERNAL_CONTINUATION_RESUBMIT_BLOCKED] 自动续接不得重复提交原生成任务')
    }
  }
}
