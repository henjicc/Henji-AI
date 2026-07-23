import { createMainLogger } from '../../logging'
import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentRunStateSchema,
  type AgentEventInput,
  type AgentRunState,
  type AgentRunStatus,
  type SerializedAgentError,
} from '../../../../../src/core/assistant/events'
import { agentToolObservationSchema, type AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepResult, ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { HostContextSnapshot, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import { AgentContextBuilder } from '../context/builder'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { shouldOffloadObservation } from '../context/offload'
import { AgentIntentRouter } from '../context/router'
import { sanitizeObservationValue } from '../context/sanitize'
import type { AgentRouteDecision } from '../context/types'
import { AgentToolGatewayError } from '../tools/gateway'
import { digestJson } from '../tools/security'
import { AgentBudgetExceededError, AgentBudgetTracker } from './budget'
import { AgentEventStream } from './event-stream'
import { selectAgentRuntimeModels } from './models'
import { AgentStateMachine, isTerminalAgentState } from './state-machine'
import type { AgentRunnerOptions } from './types'

const logger = createMainLogger('main.agent_runtime')

interface ApprovalWaiter {
  approvalId: string
  timer: ReturnType<typeof setTimeout>
  resolve: (decision: 'approve' | 'reject' | 'expired') => void
}

function errorCode(error: unknown): string {
  if (error instanceof AgentToolGatewayError || error instanceof AgentBudgetExceededError) return error.code
  if (error instanceof Error) return error.message.match(/^\[([^\]]+)\]/)?.[1] ?? error.name
  return 'INTERNAL_ERROR'
}

function serializeError(error: unknown): SerializedAgentError {
  const code = errorCode(error)
  const message = error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : 'Agent 运行失败'
  return {
    code,
    message: message.slice(0, 1_000) || 'Agent 运行失败',
    retryable: error instanceof AgentToolGatewayError ? error.retryable : false,
    recovery: error instanceof AgentToolGatewayError ? error.recovery : 'none',
  }
}

function toolMessage(call: ModelStepToolCall, observation: AgentToolObservation): ModelStepMessage {
  const output = shouldOffloadObservation(observation.output)
    ? { summary: observation.summary, largeResultOmitted: true }
    : { summary: observation.summary, data: sanitizeObservationValue(observation.output) }
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: 'json', value: output },
    }],
  }
}

function rejectedObservation(call: ModelStepToolCall): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName: call.toolName, toolVersion: 1, toolCallId: call.toolCallId },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: '用户拒绝了本次工具调用。',
    output: { ok: false, error: { code: 'APPROVAL_REJECTED' } },
  })
}

function extractResultReferences(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>
  const references: Record<string, string> = {}
  const referenceKeys = ['taskId', 'projectId', 'nodeId', 'workspace', 'workspaceId', 'modelId'] as const
  for (const key of referenceKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) references[key] = value.slice(0, 500)
  }
  const nestedTask = record.task
  if (!references.taskId && nestedTask && typeof nestedTask === 'object' && !Array.isArray(nestedTask)) {
    const taskId = (nestedTask as Record<string, unknown>).taskId ?? (nestedTask as Record<string, unknown>).id
    if (typeof taskId === 'string' && taskId.trim()) references.taskId = taskId.slice(0, 500)
  }
  return Object.keys(references).length > 0 ? references : undefined
}

export class AgentRunner {
  private readonly machine = new AgentStateMachine()
  private readonly budget: AgentBudgetTracker
  private readonly events: AgentEventStream
  private readonly models
  private readonly contextBuilder = new AgentContextBuilder()
  private readonly catalogPlanner
  private readonly abortController = new AbortController()
  private readonly conversation: ModelStepMessage[] = []
  private readonly observations: AgentToolObservation[] = []
  private state: AgentRunState
  private pausedFrom: Exclude<AgentRunStatus, 'paused'> = 'running'
  private pauseWaiters: Array<() => void> = []
  private approvalWaiter: ApprovalWaiter | null = null
  private currentModelRequestId: string | null = null
  private started = false

  constructor(private readonly options: AgentRunnerOptions) {
    this.models = selectAgentRuntimeModels(options.request)
    this.budget = new AgentBudgetTracker(options.request.budget)
    this.events = new AgentEventStream(options.runId)
    this.catalogPlanner = new AgentToolCatalogPlanner(options.dependencies.registry)
    if (options.dependencies.onEvent) this.events.subscribe(options.dependencies.onEvent)
    const now = new Date().toISOString()
    this.state = agentRunStateSchema.parse({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      runId: options.runId,
      threadId: options.request.threadId,
      status: 'initializing',
      sequence: 0,
      turn: 0,
      currentStepId: null,
      currentToolCallId: null,
      waitingApprovalId: null,
      startedAt: now,
      updatedAt: now,
      finalText: null,
      error: null,
      budget: this.budget.config,
      usage: this.budget.snapshot(),
      lastScopeRevisions: null,
    })
  }

  start(): AgentRunState {
    if (this.started) return this.getState()
    this.started = true
    this.emit({ type: 'RunStarted', threadId: this.options.request.threadId })
    this.transition('running', this.models.fellBack ? '主模型不可用，已使用已验证备用模型' : undefined)
    logger.info('Agent 运行开始', {
      event: 'agent_runtime.run.started',
      requestId: this.options.runId,
      modelId: this.models.primary.modelId,
      providerId: this.models.primary.providerId,
      context: { threadId: this.options.request.threadId, fellBack: this.models.fellBack },
    })
    void this.execute()
    return this.getState()
  }

  getState(): AgentRunState {
    this.refreshState()
    return agentRunStateSchema.parse(this.state)
  }

  getEventHistory(): ReturnType<AgentEventStream['getHistory']> {
    return this.events.getHistory()
  }

  pause(reason = '用户暂停'): AgentRunState {
    if (isTerminalAgentState(this.machine.status) || this.machine.status === 'paused') return this.getState()
    if (this.machine.status === 'initializing') throw new Error('Agent 尚未进入可暂停状态')
    this.pausedFrom = this.machine.status
    this.transition('paused', reason)
    return this.getState()
  }

  resume(): AgentRunState {
    if (this.machine.status !== 'paused') return this.getState()
    this.transition(this.pausedFrom, '用户恢复')
    const waiters = this.pauseWaiters
    this.pauseWaiters = []
    for (const resolve of waiters) resolve()
    return this.getState()
  }

  cancel(reason = '用户取消'): AgentRunState {
    if (isTerminalAgentState(this.machine.status)) return this.getState()
    this.abortController.abort(reason)
    if (this.currentModelRequestId) this.options.dependencies.cancelModelStep(this.currentModelRequestId)
    this.options.dependencies.gateway.approvals.expireRun(this.options.runId)
    this.settleApprovalWaiter('reject')
    const waiters = this.pauseWaiters
    this.pauseWaiters = []
    for (const resolve of waiters) resolve()
    this.transition('cancelled', reason)
    this.emit({ type: 'RunCancelled', reason, usage: this.budget.snapshot() })
    logger.info('Agent 运行已取消', {
      event: 'agent_runtime.run.cancelled', requestId: this.options.runId, context: { reason },
    })
    this.finishTerminal()
    return this.getState()
  }

  respondApproval(approvalId: string, decision: 'approve' | 'reject'): AgentRunState {
    if (!this.approvalWaiter || this.approvalWaiter.approvalId !== approvalId) {
      throw new Error('审批不属于当前等待中的工具调用')
    }
    const resolved = this.options.dependencies.gateway.approvals.resolve(approvalId, this.options.runId, decision)
    const toolCallId = this.state.currentToolCallId
    if (!toolCallId) throw new Error('审批缺少关联工具调用')
    this.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: resolved })
    this.state.waitingApprovalId = null
    if (this.machine.status === 'waiting_approval') this.transition('waiting_tool')
    else if (this.machine.status === 'paused') this.pausedFrom = 'waiting_tool'
    this.settleApprovalWaiter(decision)
    return this.getState()
  }

  private async execute(): Promise<void> {
    try {
      const snapshot = this.requireContext()
      const router = new AgentIntentRouter((goal, host, signal) => this.classifyWithRouterModel(goal, host.revision, signal))
      const route = await router.route(this.options.runId, this.options.request.goal, snapshot, this.abortController.signal)
      this.emit({
        type: 'PlanUpdated',
        intent: route.intent,
        summary: route.reason,
        toolDomains: route.toolDomains,
      })
      while (!isTerminalAgentState(this.machine.status)) {
        await this.waitIfPaused()
        this.throwIfCancelled()
        const turn = this.budget.beginTurn()
        this.state.turn = turn
        const currentSnapshot = this.requireContext()
        const registrations = this.catalogPlanner.select(route, currentSnapshot)
        const context = this.contextBuilder.build({
          runId: this.options.runId,
          goal: this.options.request.goal,
          userPreferences: this.options.request.userPreferences,
          snapshot: currentSnapshot,
          route,
          conversation: this.conversation,
          observations: this.observations.slice(-20),
          modelTools: registrations.map((item) => item.modelTool),
          activeToolNames: registrations.map((item) => item.catalog.name),
          contextWindowBudget: this.options.request.profile.settings.contextWindowBudget,
        })
        this.emitContextEvents(turn, context)
        let result: ModelStepResult
        try {
          result = await this.runPrimaryStep(turn, context.messages, context.tools)
          this.budget.recordSuccess()
        } catch (error) {
          this.currentModelRequestId = null
          this.state.currentStepId = null
          this.throwIfCancelled()
          this.budget.recordFailure()
          this.conversation.push({ role: 'user', content: `上一模型步骤失败，安全错误码：${errorCode(error)}。请重新规划。` })
          continue
        }
        this.conversation.push(...result.responseMessages)
        if (result.toolCalls.length > 0) {
          await this.executeToolCalls(result.toolCalls, route, currentSnapshot.scopeRevisions)
          continue
        }
        const finalText = result.text.trim() || (result.structuredOutput ? JSON.stringify(result.structuredOutput) : '')
        if (!finalText || (route.intent !== 'general' && this.observations.length === 0)) {
          this.budget.recordFailure()
          this.budget.recordProgress(`no-tool:${route.intent}:${result.finishReason}`)
          this.conversation.push({
            role: 'user',
            content: '尚无网关工具结果证明任务完成。请调用合适工具，或明确说明无法执行的原因。',
          })
          continue
        }
        this.complete(finalText)
      }
    } catch (error) {
      if (this.machine.status !== 'cancelled') this.fail(error)
    }
  }

  private async classifyWithRouterModel(goal: string, revision: number, signal: AbortSignal): Promise<unknown> {
    this.throwIfCancelled()
    const requestId = `${this.options.runId}:router:${revision}`
    this.currentModelRequestId = requestId
    try {
      const result = await this.options.dependencies.runModelStep({
        requestId,
        runId: this.options.runId,
        stepId: `router:${revision}`,
        providerId: this.models.router.providerId,
        modelId: this.models.router.modelId,
        adapter: this.models.router.adapter,
        baseUrl: this.models.router.baseUrl,
        messages: [
          { role: 'system', content: '只分类用户意图。输出必须符合给定 JSON 结构，不执行工具。' },
          { role: 'user', content: goal },
        ],
        output: {
          mode: 'object',
          name: 'agent_intent_route',
          schema: {
            type: 'object',
            properties: {
              intent: { type: 'string', enum: ['navigate', 'generate', 'inspect_model', 'read_generation', 'cancel_generation', 'diagnose', 'general'] },
              complexity: { type: 'string', enum: ['simple', 'multi_step', 'ambiguous'] },
              path: { type: 'string', enum: ['workflow', 'primary'] },
              toolDomains: { type: 'array', items: { type: 'string' }, maxItems: 4 },
              reason: { type: 'string', maxLength: 500 },
            },
            required: ['intent', 'complexity', 'path', 'toolDomains', 'reason'],
            additionalProperties: false,
          },
        },
        capabilities: this.models.router.capabilities,
        settings: this.models.router.settings,
      }, () => undefined)
      if (signal.aborted) throw new Error('[task_cancelled] router cancelled')
      this.budget.recordModelUsage(result.usage)
      return result.structuredOutput
    } finally {
      this.currentModelRequestId = null
    }
  }

  private async runPrimaryStep(
    turn: number,
    messages: ModelStepMessage[],
    tools: Parameters<typeof this.options.dependencies.runModelStep>[0]['tools']
  ): Promise<ModelStepResult> {
    const stepId = `step-${turn}`
    const requestId = `${this.options.runId}:${stepId}`
    this.currentModelRequestId = requestId
    this.state.currentStepId = stepId
    this.emit({
      type: 'ModelStarted', stepId, turn,
      providerId: this.models.primary.providerId, modelId: this.models.primary.modelId,
    })
    const result = await this.options.dependencies.runModelStep({
      requestId,
      runId: this.options.runId,
      stepId,
      providerId: this.models.primary.providerId,
      modelId: this.models.primary.modelId,
      adapter: this.models.primary.adapter,
      baseUrl: this.models.primary.baseUrl,
      messages,
      tools,
      output: { mode: 'text' },
      capabilities: this.models.primary.capabilities,
      settings: this.models.primary.settings,
    }, (event) => {
      if (event.type === 'TextDelta') this.emit({ type: 'ModelDelta', stepId, text: event.text })
    })
    this.throwIfCancelled()
    this.budget.recordModelUsage(result.usage)
    this.emit({
      type: 'ModelCompleted', stepId, finishReason: result.finishReason,
      toolCallCount: result.toolCalls.length, usage: result.usage,
    })
    this.currentModelRequestId = null
    this.state.currentStepId = null
    return result
  }

  private async executeToolCalls(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>
  ): Promise<void> {
    for (const call of calls.slice(0, 4)) {
      await this.waitIfPaused()
      this.throwIfCancelled()
      this.budget.recordToolCall(`${call.toolName}:${digestJson(call.input)}`)
      this.state.currentToolCallId = call.toolCallId
      this.transition('waiting_tool')
      this.emit({ type: 'ToolRequested', toolCallId: call.toolCallId, toolName: call.toolName, inputDigest: digestJson(call.input) })
      this.emit({ type: 'ToolStarted', toolCallId: call.toolCallId, toolName: call.toolName })
      try {
        let result = await this.options.dependencies.gateway.execute({
          runId: this.options.runId,
          threadId: this.options.request.threadId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          expectedRevisions,
          explicitUserIntent: route.source === 'deterministic',
          signal: this.abortController.signal,
        })
        if (result.status === 'approval_required') {
          this.state.waitingApprovalId = result.approval.approvalId
          this.transition('waiting_approval')
          const approvalDecision = this.waitForApproval(result.approval.approvalId, result.approval.expiresAt)
          this.emit({ type: 'ApprovalRequired', toolCallId: call.toolCallId, approval: result.approval })
          const decision = await approvalDecision
          await this.waitIfPaused()
          this.throwIfCancelled()
          if (decision !== 'approve') {
            const expired = decision === 'expired'
            const observation = expired
              ? agentToolObservationSchema.parse({
                  source: { toolName: call.toolName, toolVersion: 1, toolCallId: call.toolCallId },
                  trust: 'untrusted_observation',
                  dataClasses: ['C0'],
                  summary: '本次工具审批已过期。',
                  output: { ok: false, error: { code: 'APPROVAL_EXPIRED' } },
                })
              : rejectedObservation(call)
            this.observations.push(observation)
            this.conversation.push(toolMessage(call, observation))
            this.emit({
              type: 'ToolFailed',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              error: serializeError(new AgentToolGatewayError(
                expired ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED',
                expired ? '工具审批已过期' : '用户拒绝了工具调用'
              )),
            })
            this.transition('running')
            continue
          }
          result = await this.options.dependencies.gateway.execute({
            runId: this.options.runId,
            threadId: this.options.request.threadId,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
            expectedRevisions,
            approvalId: result.approval.approvalId,
            explicitUserIntent: route.source === 'deterministic',
            signal: this.abortController.signal,
          })
        }
        if (result.status !== 'completed') throw new Error('工具审批状态未收敛')
        this.observations.push(result.observation)
        this.conversation.push(toolMessage(call, result.observation))
        this.budget.recordProgress(`${call.toolName}:${digestJson(result.observation.output)}`)
        this.emit({
          type: 'ToolCompleted', toolCallId: call.toolCallId, toolName: call.toolName,
          summary: result.observation.summary,
          artifactRef: result.observation.artifactRef,
          resultReferences: extractResultReferences(result.observation.output),
        })
      } catch (error) {
        this.throwIfCancelled()
        const serialized = serializeError(error)
        const observation = agentToolObservationSchema.parse({
          source: { toolName: call.toolName, toolVersion: 1, toolCallId: call.toolCallId },
          trust: 'untrusted_observation',
          dataClasses: ['C0'],
          summary: `工具调用失败：${serialized.code}`,
          output: { ok: false, error: serialized },
        })
        this.observations.push(observation)
        this.conversation.push(toolMessage(call, observation))
        this.emit({ type: 'ToolFailed', toolCallId: call.toolCallId, toolName: call.toolName, error: serialized })
      } finally {
        this.state.currentToolCallId = null
        this.state.waitingApprovalId = null
        if (this.machine.status === 'waiting_tool' || this.machine.status === 'waiting_approval') this.transition('running')
        else if (this.machine.status === 'paused') this.pausedFrom = 'running'
      }
    }
  }

  private waitForApproval(approvalId: string, expiresAt: string): Promise<'approve' | 'reject' | 'expired'> {
    return new Promise((resolve) => {
      const delay = Math.max(0, Date.parse(expiresAt) - Date.now())
      const timer = setTimeout(() => {
        if (this.approvalWaiter?.approvalId !== approvalId) return
        this.options.dependencies.gateway.approvals.expire(approvalId, this.options.runId)
        const toolCallId = this.state.currentToolCallId
        if (toolCallId) this.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: 'expired' })
        this.state.waitingApprovalId = null
        if (this.machine.status === 'waiting_approval') this.transition('waiting_tool', '审批已过期')
        else if (this.machine.status === 'paused') this.pausedFrom = 'waiting_tool'
        this.settleApprovalWaiter('expired')
      }, delay)
      this.approvalWaiter = { approvalId, timer, resolve }
    })
  }

  private settleApprovalWaiter(decision: 'approve' | 'reject' | 'expired'): void {
    const waiter = this.approvalWaiter
    if (!waiter) return
    this.approvalWaiter = null
    clearTimeout(waiter.timer)
    waiter.resolve(decision)
  }

  private async waitIfPaused(): Promise<void> {
    while (this.machine.status === 'paused' && !this.abortController.signal.aborted) {
      await new Promise<void>((resolve) => this.pauseWaiters.push(resolve))
    }
  }

  private requireContext(): HostContextSnapshot {
    const context = this.options.dependencies.getHostContext(this.options.runId)
    if (!context?.uiReady) throw new AgentToolGatewayError('NOT_READY', '宿主界面尚未就绪', true, 'wait')
    this.state.lastScopeRevisions = context.scopeRevisions
    return context
  }

  private throwIfCancelled(): void {
    if (this.abortController.signal.aborted || this.machine.status === 'cancelled') {
      throw new Error('[task_cancelled] Agent run cancelled')
    }
  }

  private complete(finalText: string): void {
    this.state.finalText = finalText
    this.transition('completed')
    this.emit({ type: 'RunCompleted', finalText, usage: this.budget.snapshot() })
    logger.info('Agent 运行完成', {
      event: 'agent_runtime.run.completed', requestId: this.options.runId,
      context: { turns: this.budget.snapshot().turns, toolCalls: this.budget.snapshot().toolCalls },
    })
    this.finishTerminal()
  }

  private fail(error: unknown): void {
    const serialized = serializeError(error)
    this.state.error = serialized
    this.transition('failed', serialized.code)
    this.emit({ type: 'RunFailed', error: serialized, usage: this.budget.snapshot() })
    logger.error('Agent 运行失败', {
      event: 'agent_runtime.run.failed', requestId: this.options.runId,
      context: { errorCode: serialized.code, turns: this.budget.snapshot().turns },
    })
    this.finishTerminal()
  }

  private finishTerminal(): void {
    this.options.dependencies.onTerminal?.(this.getState())
  }

  private transition(next: AgentRunStatus, reason?: string): void {
    const previous = this.machine.transition(next)
    this.state.status = next
    if (previous !== next) this.emit({ type: 'RunStateChanged', previous, current: next, reason })
  }

  private emitContextEvents(turn: number, context: ReturnType<AgentContextBuilder['build']>): void {
    this.emit({
      type: 'ContextUpdated', turn, snapshotRevision: context.snapshotRevision,
      activeToolNames: context.activeToolNames, estimatedTokens: context.estimatedTokens,
    })
    if (context.compacted) {
      this.emit({ type: 'ContextCompacted', beforeTokens: context.beforeCompactionTokens, afterTokens: context.estimatedTokens })
    }
    for (const artifact of context.offloaded) {
      this.emit({ type: 'ArtifactOffloaded', artifactRef: artifact.artifactRef, source: artifact.source, originalBytes: artifact.originalBytes })
    }
  }

  private emit(input: AgentEventInput): void {
    const event = this.events.emit(input)
    this.state.sequence = event.sequence
    this.refreshState()
  }

  private refreshState(): void {
    this.state.status = this.machine.status
    this.state.usage = this.budget.snapshot()
    this.state.updatedAt = new Date().toISOString()
  }
}
