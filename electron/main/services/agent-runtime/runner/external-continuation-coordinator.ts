import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentExternalContinuation } from '../../../../../src/core/assistant/externalWait'
import type { HostContextSnapshot, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import type { AgentContextBuildResult } from '../context/types'
import type { AgentToolActivationSnapshot } from '../context/tool-activation'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import type { AgentToolExecutionCoordinator } from './tool-execution-coordinator'
import { RESUME_HENJI_SCRIPT_TOOL } from '../henji-script/tools'

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

  /**
   * 外部续跑的第一步是宿主生成的权威读取，不是模型自由选择的“看一眼”。
   * 只有它返回了覆盖原外部任务稳定引用的已验证 observe receipt，才能消除
   * retry 创建子运行时因 revision 变化产生的 resume_read_only 状态。
   *
   * 这个判定不依赖工具成功文本，也不依赖图片生成的业务字段；只消费宿主生成的
   * toolCallId 和强类型 Effect Receipt。
   */
  verifiesRecovery(call: ModelStepToolCall, observation: AgentToolObservation): boolean {
    const continuation = this.options.continuation
    if (!continuation
      || call.toolCallId !== `external:${continuation.waitId}:query`
      || call.toolName !== QUERY_TOOL) return false
    return (observation.effects ?? []).some((effect) => (
      effect.effect === 'observe'
      && effect.verified
      && effect.targetRefs.some((ref) => (
        ref.kind === 'generation.task' && ref.id === continuation.taskId
      ))
    ))
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
    const activeToolNames = registrations.map((item) => item.catalog.name)
    const activeNameSet = new Set(activeToolNames)
    const pinnedToolNames = activation.pinnedToolNames
      .filter((name) => activeNameSet.has(name))
    return {
      ...activation,
      registrations,
      activeToolNames,
      pinnedToolNames,
      droppedPinnedToolNames: [...new Set([
        ...activation.droppedPinnedToolNames,
        ...activation.pinnedToolNames.filter((name) => !activeNameSet.has(name)),
      ])],
    }
  }

  async queryAuthoritativeStatus(input: {
    snapshot: AgentTurnSnapshotDraft
    route: AgentRouteDecision
    scopeRevisions: HostScopeRevisions
    activeToolNames: string[]
    refreshHost: () => HostContextSnapshot
    rebuild: (host?: HostContextSnapshot) => AgentContextBuildResult
  }): Promise<{
    context: AgentContextBuildResult
    host: HostContextSnapshot
    terminalError?: Error
  } | null> {
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
      // 状态事件本身可能刚刚推进 generation revision。这里是只读的权威终态查询，
      // 不应拿构建上下文前的 revision 制造一次注定无副作用的 STALE_CONTEXT。
      {},
      new Set([...input.activeToolNames, QUERY_TOOL])
    )
    const terminalError = continuation.observedStatus === 'success'
      ? null
      : new Error(
          `[SCRIPT_STEP_FAILED] 外部生成以 ${continuation.observedStatus} 结束，后续写入未执行`,
        )
    if (continuation.scriptCheckpoint && !terminalError) {
      const resumeCall: ModelStepToolCall = {
        toolCallId: `external:${continuation.waitId}:resume-script`,
        toolName: RESUME_HENJI_SCRIPT_TOOL,
        input: {
          checkpoint: continuation.scriptCheckpoint,
          observedStatus: continuation.observedStatus,
        },
        dynamic: false,
      }
      await this.options.tools.execute(
        [resumeCall], input.route, {},
        new Set([...input.activeToolNames, QUERY_TOOL, RESUME_HENJI_SCRIPT_TOOL]),
        new Set([RESUME_HENJI_SCRIPT_TOOL]),
      )
    }
    await this.options.savePoints.save('after_tools', input.snapshot)
    const host = input.refreshHost()
    return {
      context: input.rebuild(host),
      host,
      ...(terminalError ? { terminalError } : {}),
    }
  }

  assertNoResubmit(toolCalls: ModelStepToolCall[]): void {
    if (!this.options.continuation) return
    if (toolCalls.some((call) => call.toolName === FORBIDDEN_TOOL)) {
      throw new Error('[EXTERNAL_CONTINUATION_RESUBMIT_BLOCKED] 自动续接不得重复提交原生成任务')
    }
  }
}
