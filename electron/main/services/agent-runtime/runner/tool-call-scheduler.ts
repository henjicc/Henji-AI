import type { AgentApprovalRequest, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import {
  agentToolObservationSchema,
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
  rejectedObservation,
  serializeError,
} from './runner-results'

type ApprovalDecision = 'approve' | 'reject' | 'expired'

interface ToolCallOutcome {
  call: ModelStepToolCall
  observation: AgentToolObservation
  error: ReturnType<typeof serializeError> | null
  resultingRevisions: HostScopeRevisions | null
  activationRecoveryQueued: boolean
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
  signal: AbortSignal
  waitIfPaused: () => Promise<void>
  throwIfCancelled: () => void
  recordToolCall: (signature: string) => void
  recordProgress: (signature: string) => void
  recordFailure?: () => void
  recordSuccess?: () => void
  setActiveToolCall: (toolCallId: string | null) => void
  requestApproval: (call: ModelStepToolCall, approval: AgentApprovalRequest) => Promise<ApprovalDecision>
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  emit: (event: AgentEventInput) => void
  onDiscoveredTools: (toolCallId: string, toolNames: string[]) => void
  executionGuard?: (call: ModelStepToolCall) => string | null
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
    for (const batch of createBatches(
      calls,
      this.options.supportsParallelTools,
      this.options.registry
    )) {
      await this.options.waitIfPaused()
      this.options.throwIfCancelled()
      this.options.setActiveToolCall(batch[0]?.toolCallId ?? null)
      const outcomes = await Promise.all(batch.map((call) => this.executeOne(
        call,
        explicitUserIntent,
        currentExpectedRevisions
      )))
      for (const outcome of outcomes) this.recordOutcome(outcome)
      currentExpectedRevisions = mergeRevisions(currentExpectedRevisions, outcomes)
      this.options.setActiveToolCall(null)
    }
  }

  private async executeOne(
    call: ModelStepToolCall,
    explicitUserIntent: boolean,
    expectedRevisions: Partial<HostScopeRevisions>
  ): Promise<ToolCallOutcome> {
    let activationRecoveryQueued = false
    this.options.recordToolCall(`${call.toolName}:${digestJson(call.input)}`)
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
      if (!this.options.activeToolNames.has(call.toolName)) {
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
      const guardReason = this.options.executionGuard?.(call)
      if (guardReason) {
        throw new AgentToolGatewayError(
          'RECOVERY_VERIFICATION_REQUIRED',
          guardReason,
          false,
          'user_action'
        )
      }
      let result = await this.options.gateway.execute({
        runId: this.options.runId,
        threadId: this.options.threadId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        expectedRevisions,
        approvalMode: this.options.approvalMode,
        explicitUserIntent,
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
          signal: this.options.signal,
        })
      }
      if (result.status !== 'completed') throw new Error('工具审批状态未收敛')
      return {
        call,
        observation: result.observation,
        error: null,
        resultingRevisions: extractResultScopeRevisions(result.observation.output),
        activationRecoveryQueued: false,
      }
    } catch (error) {
      this.options.throwIfCancelled()
      const serialized = serializeError(error)
      return {
        call,
        observation: failedObservation(call, serialized),
        error: serialized,
        resultingRevisions: null,
        activationRecoveryQueued,
      }
    }
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
      if (!outcome.activationRecoveryQueued) this.options.recordFailure?.()
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
  }
}
