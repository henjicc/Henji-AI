import { createMainLogger } from '../../logging'
import type { AgentApprovalRequest, AgentEventInput, AgentRunState, AgentRunStatus } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepResult, ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { HostContextSnapshot, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import { AgentContextBuilder } from '../context/builder'
import { AgentArtifactStore } from '../context/offload'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { AgentIntentRouter } from '../context/router'
import type { AgentRouteDecision } from '../context/types'
import { AgentToolGatewayError } from '../tools/gateway'
import { AgentBudgetTracker } from './budget'
import { createInitialAgentRunState } from './initial-state'
import { buildPrimaryModelTraceMetadata, runPrimaryAgentModelStep, runRouterModelClassification } from './model-execution'
import { selectAgentRuntimeModels } from './models'
import { errorCode, toolMessage } from './runner-results'
import { AgentStateMachine, isTerminalAgentState } from './state-machine'
import { AgentToolCallScheduler } from './tool-call-scheduler'
import { buildRecoveryGuidance, verifyAgentCompletion } from './result-verifier'
import type { AgentRunnerOptions } from './types'
import { AgentApprovalWaiter } from './approval-waiter'
import { AgentRecoveryWriteGuard } from './recovery-guard'
import { markWorkingSummaryRecoveryVerified } from './working-summary'
import { AgentMemoryContextProvider } from './memory-context'
import { emitAgentContextEvents } from './context-events'
import { AgentRunnerLifecycle } from './lifecycle'
import { AgentModelOutputGuard } from './model-output-guard'
import { logApprovalExpired, logApprovalRequested, logApprovalResolved } from './approval-logging'
import { AgentTerminalApprovalCleanup } from './terminal-approval-cleanup'

const logger = createMainLogger('main.agent_runtime')
export class AgentRunner {
  private readonly machine = new AgentStateMachine()
  private readonly budget: AgentBudgetTracker
  private readonly lifecycle: AgentRunnerLifecycle
  private readonly models
  private readonly contextBuilder: AgentContextBuilder
  private readonly catalogPlanner
  private readonly abortController = new AbortController()
  private readonly conversation: ModelStepMessage[]
  private readonly observations: AgentToolObservation[] = []
  private state: AgentRunState
  private pausedFrom: Exclude<AgentRunStatus, 'paused'> = 'running'
  private pauseWaiters: Array<() => void> = []
  private readonly approvalWaiter = new AgentApprovalWaiter()
  private readonly recoveryGuard: AgentRecoveryWriteGuard
  private readonly memoryProvider: AgentMemoryContextProvider
  private readonly modelOutputGuard: AgentModelOutputGuard
  private readonly terminalApprovalCleanup: AgentTerminalApprovalCleanup
  private currentModelRequestId: string | null = null
  private asyncEventError: unknown | null = null
  private started = false

  constructor(private readonly options: AgentRunnerOptions) {
    this.conversation = [...(options.conversationHistory ?? [])]
    this.models = selectAgentRuntimeModels(options.request)
    this.budget = new AgentBudgetTracker(options.request.budget)
    this.contextBuilder = new AgentContextBuilder(options.dependencies.artifactStore ?? new AgentArtifactStore())
    this.catalogPlanner = new AgentToolCatalogPlanner(options.dependencies.registry)
    this.state = createInitialAgentRunState(options.runId, options.request, options.recoveryContext)
    this.lifecycle = new AgentRunnerLifecycle({
      runId: options.runId,
      state: this.state,
      machine: this.machine,
      budget: this.budget,
      dependencies: options.dependencies,
      onEventDispatchError: (error) => this.handleAsyncEventError(error),
    })
    this.modelOutputGuard = new AgentModelOutputGuard({
      registry: options.dependencies.registry,
      emit: (event) => this.emit(event),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        this.conversation.push(toolMessage(call, observation))
      },
      onRecoveryMessage: (message) => this.conversation.push({ role: 'user', content: message }),
    })
    this.recoveryGuard = new AgentRecoveryWriteGuard(this.state.workingSummary, options.dependencies.registry)
    this.memoryProvider = new AgentMemoryContextProvider(options.runId, options.memoryContext ?? [], options.dependencies.retrieveMemory)
    this.terminalApprovalCleanup = new AgentTerminalApprovalCleanup(
      options.runId, () => options.dependencies.gateway.expireRunApprovals(options.runId))
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
      context: {
        threadId: this.options.request.threadId,
        fellBack: this.models.fellBack,
        contextWindow: this.models.primary.limits.contextWindow,
        contextWindowSource: this.models.primary.limits.contextWindowSource,
        maxOutputTokens: this.models.primary.settings.maxOutputTokens,
      },
    })
    void this.execute()
    return this.getState()
  }

  getState(): AgentRunState { return this.lifecycle.getState() }
  getEventHistory(): ReturnType<AgentRunnerLifecycle['getEventHistory']> { return this.lifecycle.getEventHistory() }
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
    this.terminalApprovalCleanup.start()
    this.approvalWaiter.settle('reject')
    const waiters = this.pauseWaiters
    this.pauseWaiters = []
    for (const resolve of waiters) resolve()
    this.transition('cancelled', reason)
    this.emit({ type: 'RunCancelled', reason, usage: this.budget.snapshot() })
    logger.info('Agent 运行已取消', {
      event: 'agent_runtime.run.cancelled', requestId: this.options.runId, context: { reason },
    })
    void this.terminalApprovalCleanup.wait().then(() => this.lifecycle.finishTerminal())
    return this.getState()
  }
  async cancelAndWait(reason = '用户取消'): Promise<AgentRunState> {
    this.cancel(reason); await this.terminalApprovalCleanup.wait(); return this.getState()
  }
  async respondApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<AgentRunState> {
    if (!this.approvalWaiter.matches(approvalId)) {
      throw new Error('审批不属于当前等待中的工具调用')
    }
    if (!this.approvalWaiter.claim(approvalId)) {
      throw new Error('审批正在由另一个决策或过期流程处理')
    }
    try {
      const resolved = await this.options.dependencies.gateway.resolveApproval(
        approvalId,
        this.options.runId,
        decision
      )
      const toolCallId = this.state.currentToolCallId
      if (!toolCallId) throw new Error('审批缺少关联工具调用')
      this.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: resolved })
      logApprovalResolved(this.options.runId, toolCallId, approvalId, resolved)
      this.state.waitingApprovalId = null
      if (this.machine.status === 'waiting_approval') this.transition('waiting_tool')
      else if (this.machine.status === 'paused') this.pausedFrom = 'waiting_tool'
      this.approvalWaiter.settle(decision)
      return this.getState()
    } catch (error) {
      this.approvalWaiter.release(approvalId)
      throw error
    }
  }
  private async execute(): Promise<void> {
    try {
      const snapshot = this.requireContext()
      const router = new AgentIntentRouter((goal, host, signal) => this.classifyWithRouterModel(goal, host, signal))
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
        const activation = this.catalogPlanner.select(route, currentSnapshot)
        const registrations = activation.registrations
        logger.info('Agent 本轮工具集合已冻结', {
          event: 'agent_catalog.activation.completed',
          requestId: this.options.runId,
          context: {
            turn,
            snapshotRevision: currentSnapshot.revision,
            activeToolNames: activation.activeToolNames,
            schemaBytes: activation.schemaBytes,
            candidateCount: activation.candidateCount,
            droppedForCount: activation.droppedForCount,
            droppedForSchemaBudget: activation.droppedForSchemaBudget,
            unavailableNames: activation.unavailableNames,
          },
        })
        const memoryContext = await this.memoryProvider.retrieve({
          goal: this.options.request.goal,
          snapshot: currentSnapshot,
          route,
          summary: this.state.workingSummary,
          signal: this.abortController.signal,
        })
        const context = this.contextBuilder.build({
          runId: this.options.runId,
          goal: this.options.request.goal,
          userInstructions: this.options.request.userInstructions,
          memoryContext,
          snapshot: currentSnapshot,
          route,
          conversation: this.conversation,
          observations: this.observations.slice(-20),
          modelTools: registrations.map((item) => item.modelTool),
          activeToolNames: registrations.map((item) => item.catalog.name),
          contextWindowBudget: this.models.primary.limits.contextWindow,
          maxOutputTokens: this.models.primary.settings.maxOutputTokens,
          workingSummary: this.state.workingSummary,
        })
        emitAgentContextEvents(
          turn,
          context,
          this.state.workingSummary?.version,
          (event) => this.emit(event)
        )
        let result: ModelStepResult
        try {
          result = await this.runPrimaryStep(turn, context)
        } catch (error) {
          this.currentModelRequestId = null
          this.state.currentStepId = null
          this.throwIfCancelled()
          this.budget.recordFailure()
          this.conversation.push({ role: 'user', content: `上一模型步骤失败，安全错误码：${errorCode(error)}。请重新规划。` })
          continue
        }
        this.conversation.push(...result.responseMessages)
        if (!this.modelOutputGuard.accept(result)) {
          this.budget.recordFailure()
          continue
        }
        this.budget.recordSuccess()
        if (result.toolCalls.length > 0) {
          const observationStart = this.observations.length
          await this.executeToolCalls(
            result.toolCalls,
            route,
            currentSnapshot.scopeRevisions,
            new Set(context.activeToolNames)
          )
          const recoveryGuidance = buildRecoveryGuidance(
            this.observations.slice(observationStart),
            this.options.dependencies.registry
          )
          if (recoveryGuidance) this.conversation.push({ role: 'user', content: recoveryGuidance })
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
        const verification = verifyAgentCompletion({
          route,
          finalText,
          observations: this.observations,
          registry: this.options.dependencies.registry,
        })
        this.emit({
          type: 'VerificationCompleted',
          passed: verification.passed,
          summary: verification.summary,
          evidence: verification.evidence,
        })
        logger.info('Agent 结果验证完成', {
          event: verification.passed
            ? 'agent_verification.completed'
            : 'agent_verification.failed',
          requestId: this.options.runId,
          context: {
            intent: route.intent,
            passed: verification.passed,
            evidenceCount: verification.evidence.length,
          },
        })
        if (!verification.passed) {
          this.budget.recordFailure()
          this.budget.recordProgress(`verification:${verification.summary}`)
          this.conversation.push({
            role: 'user',
            content: `结果验证未通过：${verification.summary} 请继续恢复、查询真实状态，或向用户提出一个明确问题。`,
          })
          continue
        }
        if (verification.clarificationRequired) {
          this.emit({
            type: 'ClarificationRequired',
            question: finalText,
            reason: verification.summary,
          })
        }
        this.complete(finalText)
      }
    } catch (error) {
      if (this.machine.status !== 'cancelled') await this.fail(this.takeAsyncEventError() ?? error)
    }
  }
  private async classifyWithRouterModel(
    goal: string,
    snapshot: HostContextSnapshot,
    signal: AbortSignal
  ): Promise<unknown> {
    this.throwIfCancelled()
    const requestId = `${this.options.runId}:router:${snapshot.revision}`
    this.currentModelRequestId = requestId
    try {
      const result = await runRouterModelClassification({
        runId: this.options.runId,
        goal,
        snapshot,
        model: this.models.router,
        runModelStep: this.options.dependencies.runModelStep,
        signal,
      })
      this.budget.recordModelUsage(result.usage)
      return result.decision
    } finally {
      this.currentModelRequestId = null
    }
  }
  private async runPrimaryStep(
    turn: number,
    context: ReturnType<AgentContextBuilder['build']>
  ): Promise<ModelStepResult> {
    const stepId = `step-${turn}`
    const requestId = `${this.options.runId}:${stepId}`
    this.currentModelRequestId = requestId
    this.state.currentStepId = stepId
    this.emit({
      type: 'ModelStarted', stepId, turn,
      providerId: this.models.primary.providerId, modelId: this.models.primary.modelId,
    })
    const result = await runPrimaryAgentModelStep({
      runId: this.options.runId,
      turn,
      model: this.models.primary,
      system: context.system,
      messages: context.messages,
      tools: context.tools,
      trace: buildPrimaryModelTraceMetadata(turn, context, this.models.primary),
      runModelStep: this.options.dependencies.runModelStep,
      onTextDelta: (text) => this.emit({ type: 'ModelDelta', stepId, text }),
    })
    this.throwIfCancelled()
    this.budget.recordModelUsage(result.usage)
    const displayText = result.text.trim()
    this.emit({
      type: 'ModelCompleted', stepId, finishReason: result.finishReason,
      toolCallCount: result.toolCalls.length,
      ...(displayText ? { displayText: displayText.slice(0, 2_000) } : {}),
      usage: result.usage,
    })
    this.currentModelRequestId = null
    this.state.currentStepId = null
    return result
  }
  private async executeToolCalls(
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    expectedRevisions: Partial<HostScopeRevisions>,
    activeToolNames: ReadonlySet<string>
  ): Promise<void> {
    const scheduler = new AgentToolCallScheduler({
      runId: this.options.runId,
      threadId: this.options.request.threadId,
      approvalMode: this.options.request.approvalMode,
      supportsParallelTools: this.models.primary.capabilities.parallelTools,
      gateway: this.options.dependencies.gateway,
      registry: this.options.dependencies.registry,
      catalogPlanner: this.catalogPlanner,
      activeToolNames,
      signal: this.abortController.signal,
      waitIfPaused: () => this.waitIfPaused(),
      throwIfCancelled: () => this.throwIfCancelled(),
      recordToolCall: (signature) => this.budget.recordToolCall(signature),
      recordProgress: (signature) => this.budget.recordProgress(signature),
      setActiveToolCall: (toolCallId) => this.setActiveToolCall(toolCallId),
      requestApproval: (call, approval) => this.requestToolApproval(call, approval),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        this.conversation.push(toolMessage(call, observation))
        this.recoveryGuard.observe(call, observation)
        if (this.recoveryGuard.consumeVerification(call, observation) && this.state.workingSummary) {
          this.state.workingSummary = markWorkingSummaryRecoveryVerified(this.state.workingSummary)
        }
      },
      emit: (event) => this.emit(event),
      onDiscoveredTools: (toolCallId, toolNames) => {
        logger.info('Agent 能力目录发现新工具', {
          event: 'agent_catalog.discovery.completed',
          requestId: this.options.runId,
          taskId: toolCallId,
          context: { toolNames },
        })
      },
      executionGuard: (call) => this.recoveryGuard.validate(call),
    })
    try {
      await scheduler.execute(calls, route.intent !== 'general', expectedRevisions)
    } finally {
      this.setActiveToolCall(null)
    }
  }
  private setActiveToolCall(toolCallId: string | null): void {
    this.state.currentToolCallId = toolCallId
    if (toolCallId) this.transition('waiting_tool')
    else {
      this.state.waitingApprovalId = null
      if (this.machine.status === 'waiting_tool' || this.machine.status === 'waiting_approval') {
        this.transition('running')
      } else if (this.machine.status === 'paused') {
        this.pausedFrom = 'running'
      }
    }
  }
  private async requestToolApproval(
    call: ModelStepToolCall,
    approval: AgentApprovalRequest
  ): Promise<'approve' | 'reject' | 'expired'> {
    this.state.currentToolCallId = call.toolCallId
    this.state.waitingApprovalId = approval.approvalId
    this.transition('waiting_approval')
    const decision = this.approvalWaiter.wait({
      approvalId: approval.approvalId,
      expiresAt: approval.expiresAt,
      onExpired: () => this.handleApprovalExpired(approval.approvalId),
    })
    this.emit({ type: 'ApprovalRequired', toolCallId: call.toolCallId, approval })
    logApprovalRequested(this.options.runId, call.toolCallId, call.toolName, approval)
    return decision
  }
  private async handleApprovalExpired(approvalId: string): Promise<void> {
    try {
      await this.options.dependencies.gateway.expireApproval(approvalId, this.options.runId)
    } catch (error) {
      this.handleAsyncEventError(error)
    }
    if (!this.approvalWaiter.matches(approvalId)) return
    const toolCallId = this.state.currentToolCallId
    if (toolCallId) this.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: 'expired' })
    logApprovalExpired(this.options.runId, toolCallId, approvalId)
    this.state.waitingApprovalId = null
    if (this.machine.status === 'waiting_approval') this.transition('waiting_tool', '审批已过期')
    else if (this.machine.status === 'paused') this.pausedFrom = 'waiting_tool'
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
    if (this.asyncEventError) throw this.asyncEventError
    if (this.abortController.signal.aborted || this.machine.status === 'cancelled') {
      throw new Error('[task_cancelled] Agent run cancelled')
    }
  }

  private handleAsyncEventError(error: unknown): void {
    if (this.asyncEventError || isTerminalAgentState(this.machine.status)) return
    this.asyncEventError = error
    logger.error('Agent 异步事件刷新失败，正在受控终止运行', {
      event: 'agent_runtime.event_flush.failed',
      requestId: this.options.runId,
      context: { errorCode: errorCode(error) },
    })
    if (this.currentModelRequestId) {
      try {
        this.options.dependencies.cancelModelStep(this.currentModelRequestId)
      } catch {
        // 后续 abort 与 Runner 终局仍会继续，取消回调不能阻断错误收口。
      }
    }
    this.abortController.abort(error)
    this.approvalWaiter.settle('reject')
    const waiters = this.pauseWaiters
    this.pauseWaiters = []
    for (const resolve of waiters) resolve()
  }
  private takeAsyncEventError(): unknown | null {
    const error = this.asyncEventError
    this.asyncEventError = null
    return error
  }
  private complete(finalText: string): void { this.throwIfCancelled(); this.lifecycle.complete(finalText) }
  private async fail(error: unknown): Promise<void> {
    this.approvalWaiter.settle('reject')
    await this.terminalApprovalCleanup.run()
    if (this.machine.status !== 'cancelled') this.lifecycle.fail(error)
  }
  private transition(next: AgentRunStatus, reason?: string): void {
    this.lifecycle.transition(next, reason); if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
  private emit(input: AgentEventInput): void {
    this.lifecycle.emit(input)
    if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
}
