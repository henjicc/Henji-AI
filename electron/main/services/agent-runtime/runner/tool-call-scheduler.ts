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
  setActiveToolCall: (toolCallId: string | null) => void
  requestApproval: (call: ModelStepToolCall, approval: AgentApprovalRequest) => Promise<ApprovalDecision>
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  emit: (event: AgentEventInput) => void
  onDiscoveredTools: (toolCallId: string, toolNames: string[]) => void
  executionGuard?: (call: ModelStepToolCall) => string | null
}

const MAX_TOOL_CALLS_PER_MODEL_STEP = 8

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
    const accepted = calls.slice(0, MAX_TOOL_CALLS_PER_MODEL_STEP)
    let currentExpectedRevisions = { ...expectedRevisions }
    for (const batch of createBatches(
      accepted,
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
    for (const call of calls.slice(MAX_TOOL_CALLS_PER_MODEL_STEP)) {
      this.recordOmittedCall(call)
    }
  }

  private async executeOne(
    call: ModelStepToolCall,
    explicitUserIntent: boolean,
    expectedRevisions: Partial<HostScopeRevisions>
  ): Promise<ToolCallOutcome> {
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
        throw new AgentToolGatewayError(
          'TOOL_NOT_ACTIVE',
          '拒绝执行动态工具调用；模型只能调用本轮冻结 schema 中的静态工具',
          false,
          'user_action'
        )
      }
      if (!this.options.activeToolNames.has(call.toolName)) {
        throw new AgentToolGatewayError(
          'TOOL_NOT_ACTIVE',
          `工具 ${call.toolName} 未在本轮冻结的活动集合中披露，请先搜索能力并在下一轮调用`,
          true,
          'user_action'
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
      }
    } catch (error) {
      this.options.throwIfCancelled()
      const serialized = serializeError(error)
      return {
        call,
        observation: failedObservation(call, serialized),
        error: serialized,
        resultingRevisions: null,
      }
    }
  }

  private recordOutcome(outcome: ToolCallOutcome): void {
    const metadata = this.options.registry.executionMetadata(outcome.call.toolName, outcome.call.input)
    this.options.onObservation(outcome.call, outcome.observation)
    this.options.catalogPlanner.rememberObservation(outcome.call.toolName)
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
  }

  private recordOmittedCall(call: ModelStepToolCall): void {
    const error = serializeError(new AgentToolGatewayError(
      'CONFLICT',
      `单个模型步骤最多执行 ${MAX_TOOL_CALLS_PER_MODEL_STEP} 个工具调用，请在下一轮继续`,
      true,
      'user_action'
    ))
    const observation = failedObservation(call, error, '工具调用未执行：本轮调用数量超过安全上限。')
    this.options.emit({
      type: 'ToolRequested',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      title: this.options.registry.executionMetadata(call.toolName, call.input)?.title,
      inputDigest: digestJson(call.input),
      category: this.options.registry.executionMetadata(call.toolName, call.input)?.category,
      readOnly: this.options.registry.executionMetadata(call.toolName, call.input)?.readOnly,
      idempotent: this.options.registry.executionMetadata(call.toolName, call.input)?.idempotent,
    })
    this.options.onObservation(call, observation)
    this.options.emit({
      type: 'ToolFailed',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      error,
      category: this.options.registry.executionMetadata(call.toolName, call.input)?.category,
      readOnly: this.options.registry.executionMetadata(call.toolName, call.input)?.readOnly,
      idempotent: this.options.registry.executionMetadata(call.toolName, call.input)?.idempotent,
    })
  }
}
