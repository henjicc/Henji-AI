import type { AgentApprovalRequest, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import {
  agentToolObservationSchema,
  type AgentToolErrorCode,
  type AgentToolObservation,
} from '../../../../../src/core/assistant/toolContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolCatalogPlanner } from '../context/catalog'
import { AgentToolGatewayError, type AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'
import {
  extractResultReferences,
  extractResultScopeRevisions,
  failureEnvelope,
  rejectedObservation,
  serializeError,
} from './runner-results'
import { compileActionGroups, type CompiledActionGroup } from './action-plan-compiler'
import { AgentStopPolicyExceededError } from './budget'

type ApprovalDecision = 'approve' | 'reject' | 'expired'

interface ToolCallOutcome {
  call: ModelStepToolCall
  observation: AgentToolObservation
  error: ReturnType<typeof serializeError> | null
  resultingRevisions: HostScopeRevisions | null
  activationRecoveryQueued: boolean
  /** 首次触发的执行守卫纠正：模型能据此自纠，不应计入连续失败预算。 */
  contractCorrection: boolean
  expectedRevisions: Partial<HostScopeRevisions>
}

export interface AgentExecutionGuardRejection {
  code: AgentToolErrorCode
  reason: string
  /** true 表示这是首次出现的契约纠正；重复出现同一问题时由调用方置为 false。 */
  contractCorrection?: boolean
}

export interface AgentToolCallSchedulerOptions {
  runId: string
  threadId: string
  approvalMode: AgentApprovalMode
  supportsParallelTools: boolean
  gateway: AgentToolGateway
  registry: AgentToolRegistry
  catalogPlanner: AgentToolCatalogPlanner
  activeToolNames: ReadonlySet<string>
  trustedInternalToolNames?: ReadonlySet<string>
  signal: AbortSignal
  waitIfPaused: () => Promise<void>
  throwIfCancelled: () => void
  recordToolCall: (signature: string, write: boolean) => void
  recordProgress: (signature: string) => void
  recordFailure?: () => void
  recordSuccess?: () => void
  setActiveToolCall: (toolCallId: string | null) => void
  requestApproval: (call: ModelStepToolCall, approval: AgentApprovalRequest) => Promise<ApprovalDecision>
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  emit: (event: AgentEventInput) => void
  onDiscoveredTools: (toolCallId: string, toolNames: string[]) => void
  resolveActionGroup?: (call: ModelStepToolCall) => {
    actionGroupId: string
    mode: CompiledActionGroup['mode']
  } | null
  /**
   * 在守卫与执行之前把调用参数改写成运行时唯一正确的那一份；返回 null 表示保持原样。
   * 用于"运行时自己就知道答案"的参数（例如能力发现的依赖前沿），避免让模型去猜再判失败。
   */
  normalizeInput?: (call: ModelStepToolCall) => unknown | null
  executionGuard?: (
    call: ModelStepToolCall,
    expectedRevisions: Partial<HostScopeRevisions>,
    allowSettledActionGroupSibling: boolean
  ) => string | AgentExecutionGuardRejection | null
  onOutcome?: (
    call: ModelStepToolCall,
    observation: AgentToolObservation,
    expectedRevisions: Partial<HostScopeRevisions>
  ) => void
  finalizeSuccessfulOutcome?: (
    call: ModelStepToolCall,
    observation: AgentToolObservation,
    expectedRevisions: Partial<HostScopeRevisions>
  ) => void
}

function mergeRevisions(
  current: Partial<HostScopeRevisions>,
  outcomes: ToolCallOutcome[]
): Partial<HostScopeRevisions> {
  const merged = { ...current }
  for (const outcome of outcomes) {
    if (!outcome.resultingRevisions) continue
    for (const [scope, revision] of Object.entries(outcome.resultingRevisions)) {
      const key = scope as keyof HostScopeRevisions
      merged[key] = Math.max(merged[key] ?? 0, revision)
    }
  }
  return merged
}

function failedObservation(
  call: ModelStepToolCall,
  error: ReturnType<typeof serializeError>,
  summary = `工具调用失败：${error.code}`
): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName: call.toolName, toolVersion: 1, toolCallId: call.toolCallId },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary,
    output: { ok: false, error },
  })
}

function createBatches(
  calls: ModelStepToolCall[],
  supportsParallelTools: boolean,
  registry: AgentToolRegistry
): ModelStepToolCall[][] {
  if (!supportsParallelTools) return calls.map((call) => [call])
  const batches: ModelStepToolCall[][] = []
  let parallelBatch: ModelStepToolCall[] = []
  let concurrencyKeys = new Set<string>()
  const flush = (): void => {
    if (parallelBatch.length > 0) batches.push(parallelBatch)
    parallelBatch = []
    concurrencyKeys = new Set<string>()
  }
  for (const call of calls) {
    const metadata = registry.executionMetadata(call.toolName, call.input)
    if (!metadata?.parallelSafe || metadata.risk !== 'R0') {
      flush()
      batches.push([call])
      continue
    }
    if (concurrencyKeys.has(metadata.concurrencyKey)) flush()
    parallelBatch.push(call)
    concurrencyKeys.add(metadata.concurrencyKey)
  }
  flush()
  return batches
}

export class AgentToolCallScheduler {
  constructor(private readonly options: AgentToolCallSchedulerOptions) {}

  async execute(
    calls: ModelStepToolCall[],
    explicitUserIntent: boolean,
    expectedRevisions: Partial<HostScopeRevisions>
  ): Promise<void> {
    let currentExpectedRevisions = { ...expectedRevisions }
    const groups = compileActionGroups(
      calls,
      expectedRevisions,
      this.options.registry,
      this.options.resolveActionGroup
    )
    for (const group of groups) {
      if (group.canvasBatch) {
        const outcome = await this.executeCanvasBatch(
          group,
          explicitUserIntent,
          currentExpectedRevisions
        )
        this.recordCompiledOutcome(group, outcome)
        currentExpectedRevisions = mergeRevisions(currentExpectedRevisions, [outcome])
        this.options.setActiveToolCall(null)
        continue
      }
      const collapsed = group.executableCalls.length === 1 && group.memberCalls.length > 1
      const batches = collapsed
        ? [[group.executableCalls[0] as ModelStepToolCall]]
        : createBatches(
            [...group.executableCalls],
            this.options.supportsParallelTools,
            this.options.registry
          )
      let completedSiblingCount = 0
      for (const batch of batches) {
      await this.options.waitIfPaused()
      this.options.throwIfCancelled()
      this.options.setActiveToolCall(batch[0]?.toolCallId ?? null)
      const outcomes = await Promise.all(batch.map((call) => this.executeOne(
        call,
        explicitUserIntent,
        currentExpectedRevisions,
        collapsed ? 'approved_action_group' : 'direct',
        completedSiblingCount > 0
      )))
      for (const outcome of outcomes) {
        if (collapsed) this.recordCompiledOutcome(group, outcome)
        else this.recordOutcome(outcome)
      }
      currentExpectedRevisions = mergeRevisions(currentExpectedRevisions, outcomes)
      completedSiblingCount += outcomes.filter((outcome) => !outcome.error).length
      this.options.setActiveToolCall(null)
      }
    }
  }

  private async executeCanvasBatch(
    group: CompiledActionGroup,
    explicitUserIntent: boolean,
    expectedRevisions: Partial<HostScopeRevisions>
  ): Promise<ToolCallOutcome> {
    const batch = group.canvasBatch
    const first = group.memberCalls[0]
    if (!batch || !first) throw new Error('INVALID_COMPILED_CANVAS_BATCH')
    const planCall: ModelStepToolCall = {
      toolCallId: `${first.toolCallId}-plan`,
      toolName: 'plan_canvas_batch',
      input: { projectId: batch.projectId, operations: [...batch.operations] },
      dynamic: false,
    }
    this.options.setActiveToolCall(planCall.toolCallId)
    const planned = await this.executeOne(
      planCall, explicitUserIntent, expectedRevisions, 'direct', false, true
    )
    if (planned.error) return planned
    this.recordOutcome(planned)
    const output = planned.observation.output && typeof planned.observation.output === 'object'
      && !Array.isArray(planned.observation.output)
      ? planned.observation.output as Record<string, unknown>
      : null
    if (typeof output?.planRef !== 'string') return {
      ...planned,
      error: { code: 'INVALID_TOOL_OUTPUT', message: '画布批次计划没有返回 planRef', retryable: false, recovery: 'none' },
    }
    const commitCall: ModelStepToolCall = {
      toolCallId: `${first.toolCallId}-commit`,
      toolName: 'commit_canvas_batch',
      input: {
        planRef: output.planRef,
        compiledApprovalContext: {
          actionGroupDigest: group.digest,
          operationCount: batch.operations.length,
          targetIds: Object.fromEntries(group.memberCalls.flatMap((member, memberIndex) => {
            const definition = this.options.registry.get(member.toolName)
            if (!definition) return []
            return Object.entries(definition.targetIds(member.input)).map(([key, value]) => [
              `step_${memberIndex}_${key}`,
              value,
            ])
          }).slice(0, 31)),
          permissions: [...new Set(group.memberCalls.flatMap((member) => {
            const permission = this.options.registry.get(member.toolName)?.permission
            return permission ? [permission] : []
          }))],
        },
      },
      dynamic: false,
    }
    this.options.setActiveToolCall(commitCall.toolCallId)
    return await this.executeOne(
      commitCall, explicitUserIntent, expectedRevisions, 'approved_action_group', false, true
    )
  }

  private async executeOne(
    requestedCall: ModelStepToolCall,
    explicitUserIntent: boolean,
    expectedRevisions: Partial<HostScopeRevisions>,
    authorizationSource: 'direct' | 'approved_action_group',
    allowSettledActionGroupSibling = false,
    hostCompiled = false
  ): Promise<ToolCallOutcome> {
    let activationRecoveryQueued = false
    let contractCorrection = false
    const normalizedInput = hostCompiled ? null : this.options.normalizeInput?.(requestedCall)
    const call: ModelStepToolCall = normalizedInput === null || normalizedInput === undefined
      ? requestedCall
      : { ...requestedCall, input: normalizedInput }
    const metadata = this.options.registry.executionMetadata(call.toolName, call.input)
    this.options.emit({
      type: 'ToolRequested',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      title: metadata?.title,
      inputDigest: digestJson(call.input),
      category: metadata?.category,
      readOnly: metadata?.readOnly,
      idempotent: metadata?.idempotent,
    })
    this.options.emit({ type: 'ToolStarted', toolCallId: call.toolCallId, toolName: call.toolName })
    try {
      if (call.dynamic) {
        activationRecoveryQueued = this.options.catalogPlanner.queueKnownToolForActivation(call.toolName)
        throw new AgentToolGatewayError(
          'TOOL_NOT_ACTIVE',
          activationRecoveryQueued
            ? `工具 ${call.toolName} 本轮未披露，已安排下一轮重新披露；请仅在看到静态 schema 后重试一次`
            : '拒绝执行动态工具调用；模型只能调用本轮冻结 schema 中的静态工具',
          activationRecoveryQueued,
          activationRecoveryQueued ? 'refresh_context' : 'user_action'
        )
      }
      if (!hostCompiled && !this.options.activeToolNames.has(call.toolName)) {
        activationRecoveryQueued = this.options.catalogPlanner.queueKnownToolForActivation(call.toolName)
        throw new AgentToolGatewayError(
          'TOOL_NOT_ACTIVE',
          activationRecoveryQueued
            ? `工具 ${call.toolName} 未在本轮冻结集合中，已安排下一轮重新披露；请在下一轮重试一次`
            : `工具 ${call.toolName} 未在本轮冻结的活动集合中披露，请先搜索能力并在下一轮调用`,
          true,
          activationRecoveryQueued ? 'refresh_context' : 'user_action'
        )
      }
      const guardReason = this.options.executionGuard?.(
        call,
        expectedRevisions,
        allowSettledActionGroupSibling
      )
      if (guardReason) {
        const structured: AgentExecutionGuardRejection = typeof guardReason === 'string'
          ? { code: 'RECOVERY_VERIFICATION_REQUIRED', reason: guardReason }
          : guardReason
        contractCorrection = structured.contractCorrection === true
        throw new AgentToolGatewayError(
          structured.code,
          structured.reason,
          false,
          'user_action'
        )
      }
      this.options.recordToolCall(
        `${call.toolName}:${digestJson(call.input)}`,
        this.options.registry.get(call.toolName)?.readOnly === false
      )
      let result = await this.options.gateway.execute({
        runId: this.options.runId,
        threadId: this.options.threadId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        expectedRevisions,
        approvalMode: this.options.approvalMode,
        explicitUserIntent,
        authorizationSource,
        trustedInternal: this.options.trustedInternalToolNames?.has(call.toolName) === true,
        signal: this.options.signal,
      })
      if (result.status === 'approval_required') {
        const decision = await this.options.requestApproval(call, result.approval)
        await this.options.waitIfPaused()
        this.options.throwIfCancelled()
        if (decision !== 'approve') {
          const error = serializeError(new AgentToolGatewayError(
            decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED',
            decision === 'expired' ? '工具审批已过期' : '用户拒绝了工具调用'
          ))
          return {
            call,
            observation: decision === 'expired'
              ? failedObservation(call, error, '本次工具审批已过期。')
              : rejectedObservation(call),
            error,
            resultingRevisions: null,
            activationRecoveryQueued: false,
            contractCorrection: false,
            expectedRevisions,
          }
        }
        result = await this.options.gateway.execute({
          runId: this.options.runId,
          threadId: this.options.threadId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          expectedRevisions,
          approvalId: result.approval.approvalId,
          approvalMode: this.options.approvalMode,
          explicitUserIntent,
          authorizationSource,
          signal: this.options.signal,
        })
      }
      if (result.status !== 'completed') throw new Error('工具审批状态未收敛')
      this.options.finalizeSuccessfulOutcome?.(call, result.observation, expectedRevisions)
      const completedFailure = failureEnvelope(result.observation.output)
      return {
        call,
        observation: result.observation,
        error: completedFailure ? {
          code: completedFailure.code,
          message: completedFailure.message ?? result.observation.summary,
          retryable: false,
          recovery: ['refresh_context', 'request_approval', 'wait', 'user_action', 'none']
            .includes(completedFailure.recovery ?? '')
            ? completedFailure.recovery as 'refresh_context' | 'request_approval' | 'wait' | 'user_action' | 'none'
            : 'none',
        } : null,
        resultingRevisions: extractResultScopeRevisions(result.observation.output),
        activationRecoveryQueued: false,
        contractCorrection: false,
        expectedRevisions,
      }
    } catch (error) {
      // Harness 熔断不是业务工具失败，不能包装成一次可重试 observation，否则模型还能继续
      // 消耗调用并借后续轮次绕过硬预算。
      if (error instanceof AgentStopPolicyExceededError) throw error
      this.options.throwIfCancelled()
      const serialized = serializeError(error)
      return {
        call,
        observation: failedObservation(call, serialized),
        error: serialized,
        resultingRevisions: null,
        activationRecoveryQueued,
        contractCorrection,
        expectedRevisions,
      }
    }
  }

  private recordCompiledOutcome(group: CompiledActionGroup, outcome: ToolCallOutcome): void {
    const output = outcome.observation.output
    const decoratedOutput = output && typeof output === 'object' && !Array.isArray(output)
      ? { ...output as Record<string, unknown>, compiledActionGroup: {
          actionGroupId: group.actionGroupId,
          digest: group.digest,
          memberCount: group.memberCalls.length,
        } }
      : output
    this.recordOutcome({
      ...outcome,
      // 编译后的事务/领域批次本身就能解析所有 Effect；只结算一次，避免复制同一输出。
      observation: agentToolObservationSchema.parse({
        ...outcome.observation,
        output: decoratedOutput,
      }),
    })
  }

  private recordOutcome(outcome: ToolCallOutcome): void {
    const metadata = this.options.registry.executionMetadata(outcome.call.toolName, outcome.call.input)
    this.options.onObservation(outcome.call, outcome.observation)
    if (outcome.error?.code !== 'TOOL_NOT_ACTIVE' || outcome.activationRecoveryQueued) {
      this.options.catalogPlanner.rememberObservation(
        outcome.call.toolName,
        outcome.error ? undefined : outcome.observation.output
      )
    }
    if (outcome.error) {
      this.options.emit({
        type: 'ToolFailed',
        toolCallId: outcome.call.toolCallId,
        toolName: outcome.call.toolName,
        error: outcome.error,
        category: metadata?.category,
        readOnly: metadata?.readOnly,
        idempotent: metadata?.idempotent,
      })
      // 首次守卫纠正和工具重新披露一样，是"运行时告诉模型正确用法"，不是业务失败。
      // 都计进连续失败预算的话，模型每被纠正一次就离被掐死更近一步。
      if (!outcome.activationRecoveryQueued && !outcome.contractCorrection) {
        this.options.recordFailure?.()
      }
      this.options.onOutcome?.(outcome.call, outcome.observation, outcome.expectedRevisions)
      return
    }
    const discovered = this.options.catalogPlanner.rememberDiscovered(
      outcome.call.toolName,
      outcome.observation.output
    )
    if (discovered.length > 0) {
      this.options.onDiscoveredTools(outcome.call.toolCallId, discovered)
    }
    this.options.recordProgress(
      `${outcome.call.toolName}:${digestJson(outcome.observation.output)}`
    )
    this.options.emit({
      type: 'ToolCompleted',
      toolCallId: outcome.call.toolCallId,
      toolName: outcome.call.toolName,
      summary: outcome.observation.summary,
      category: metadata?.category,
      readOnly: metadata?.readOnly,
      idempotent: metadata?.idempotent,
      completionKind: metadata?.completionKind,
      artifactRef: outcome.observation.artifactRef,
      resultReferences: extractResultReferences(outcome.observation.output),
    })
    this.options.recordSuccess?.()
    this.options.onOutcome?.(outcome.call, outcome.observation, outcome.expectedRevisions)
  }
}
