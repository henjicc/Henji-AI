import { createMainLogger } from '../../logging'
import { randomUUID } from 'node:crypto'
import type { AgentEventInput, AgentRunState, AgentRunStatus } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentArtifactStore } from '../context/offload'
import { AgentContextBuilder } from '../context/builder'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { AgentIntentRouter } from '../context/router'
import { AgentToolGatewayError } from '../tools/gateway'
import { AgentRunMetrics } from './budget'
import { createInitialAgentRunState } from './initial-state'
import { selectAgentRuntimeModels } from './models'
import { errorCode, toolMessage } from './runner-results'
import { AgentStateMachine, isTerminalAgentState } from './state-machine'
import { buildRecoveryGuidance } from './result-verifier'
import type { AgentRunnerOptions } from './types'
import { AgentRecoveryWriteGuard } from './recovery-guard'
import { markWorkingSummaryRecoveryVerified } from './working-summary'
import { AgentMemoryContextProvider } from './memory-context'
import { AgentRunnerLifecycle } from './lifecycle'
import { AgentModelOutputGuard } from './model-output-guard'
import { AgentTerminalApprovalCleanup } from './terminal-approval-cleanup'
import { isContextOverflowError } from '../context/semantic-compaction'
import { AgentConversationCompactor } from './conversation-compactor'
import { AgentModelTurnCoordinator } from './model-turn-coordinator'
import { AgentToolExecutionCoordinator } from './tool-execution-coordinator'
import { AgentSavePointCoordinator } from './save-point-coordinator'
import { AgentTurnContextCoordinator } from './turn-context-coordinator'
import { logAgentToolActivation } from './activation-logging'
import { AgentClarificationWaiter } from './clarification-waiter'
import { AgentApprovalCoordinator } from './approval-coordinator'
import { AgentCurrentMessageConsumer } from './current-message-consumer'
import { AgentExternalWaitRegistration } from './external-wait-registration'
import { AgentExternalContinuationCoordinator } from './external-continuation-coordinator'
import { AgentPauseController } from './pause-controller'
import { startAgentRun } from './run-start'
import { AgentConversationJournal } from './conversation-journal'
import { AgentCompletionCoordinator } from './completion-coordinator'
import { AgentThreadTitleCoordinator } from './thread-title-coordinator'
const logger = createMainLogger('main.agent_runtime')
export class AgentRunner {
  private readonly machine = new AgentStateMachine()
  private readonly budget: AgentRunMetrics
  private readonly lifecycle: AgentRunnerLifecycle
  private readonly models
  private readonly catalogPlanner
  private readonly abortController = new AbortController()
  private readonly conversation: ModelStepMessage[]
  private readonly conversationSourceSequences: number[]
  private readonly conversationJournal: AgentConversationJournal
  private readonly conversationCompactor: AgentConversationCompactor
  private readonly modelTurnCoordinator: AgentModelTurnCoordinator
  private readonly toolExecutionCoordinator: AgentToolExecutionCoordinator
  private readonly savePointCoordinator: AgentSavePointCoordinator
  private readonly turnContextCoordinator: AgentTurnContextCoordinator
  private readonly observations: AgentToolObservation[] = []
  private state: AgentRunState
  private readonly pauseController: AgentPauseController
  private readonly approvalCoordinator: AgentApprovalCoordinator
  private readonly currentMessageConsumer: AgentCurrentMessageConsumer
  private readonly externalWaitRegistration: AgentExternalWaitRegistration
  private readonly externalContinuation: AgentExternalContinuationCoordinator
  private readonly clarificationWaiter = new AgentClarificationWaiter()
  private readonly recoveryGuard: AgentRecoveryWriteGuard
  private readonly memoryProvider: AgentMemoryContextProvider
  private readonly modelOutputGuard: AgentModelOutputGuard
  private readonly terminalApprovalCleanup: AgentTerminalApprovalCleanup
  private readonly completionCoordinator: AgentCompletionCoordinator
  private readonly threadTitleCoordinator: AgentThreadTitleCoordinator
  private currentModelRequestId: string | null = null
  private asyncEventError: unknown | null = null
  private started = false; constructor(private readonly options: AgentRunnerOptions) {
    this.conversationJournal = new AgentConversationJournal({
      runId: options.runId,
      threadId: options.request.threadId,
      history: options.conversationHistory,
      historySequences: options.conversationHistorySequences,
      append: options.dependencies.appendSessionInternal,
      getTurn: () => this.state?.turn ?? 0,
    })
    this.conversation = this.conversationJournal.messages
    this.conversationSourceSequences = this.conversationJournal.sourceSequences
    this.currentMessageConsumer = new AgentCurrentMessageConsumer(
      options.runId,
      this.conversation,
      this.conversationSourceSequences,
      options.dependencies.consumeCurrentTaskMessages
    )
    this.models = selectAgentRuntimeModels(options.request)
    this.threadTitleCoordinator = new AgentThreadTitleCoordinator({
      runId: options.runId,
      threadId: options.request.threadId,
      model: this.models.summarizer,
      runModelStep: options.dependencies.runModelStep,
      getContext: options.dependencies.getThreadTitleContext,
      updateTitle: options.dependencies.updateThreadTitle,
    })
    this.budget = new AgentRunMetrics(options.request.budget)
    this.catalogPlanner = new AgentToolCatalogPlanner(options.dependencies.registry)
    this.catalogPlanner.restoreDiscovered(this.conversation.flatMap((message) => {
      if (message.role !== 'tool' || !Array.isArray(message.content)) return []
      return message.content.flatMap((part) => {
        const names = part.addedToolNames
        return Array.isArray(names)
          ? names.filter((name): name is string => typeof name === 'string')
          : []
      })
    }))
    this.state = createInitialAgentRunState(options.runId, options.request, options.recoveryContext)
    this.lifecycle = new AgentRunnerLifecycle({
      runId: options.runId,
      state: this.state,
      machine: this.machine,
      budget: this.budget,
      dependencies: options.dependencies,
      onEventDispatchError: (error) => this.handleAsyncEventError(error),
    })
    this.completionCoordinator = new AgentCompletionCoordinator({
      runId: options.runId,
      registry: options.dependencies.registry,
      emit: (event) => this.emit(event),
    })
    this.pauseController = new AgentPauseController({
      getStatus: () => this.machine.status,
      transition: (status, reason) => this.transition(status, reason),
      setCurrentToolCallId: (toolCallId) => { this.state.currentToolCallId = toolCallId },
      clearWaitingApprovalId: () => { this.state.waitingApprovalId = null },
    })
    this.modelOutputGuard = new AgentModelOutputGuard({
      registry: options.dependencies.registry,
      emit: (event) => this.emit(event),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        this.conversationJournal.appendInternal(
          'tool_result',
          toolMessage(call, observation),
          `tool:${call.toolCallId}`
        )
      },
      onRecoveryMessage: (message) => this.conversationJournal.appendEphemeral({
        role: 'user',
        content: message,
      }),
    })
    this.recoveryGuard = new AgentRecoveryWriteGuard(this.state.workingSummary, options.dependencies.registry)
    this.memoryProvider = new AgentMemoryContextProvider(options.runId, options.memoryContext ?? [], options.dependencies.retrieveMemory)
    this.terminalApprovalCleanup = new AgentTerminalApprovalCleanup(options.runId, () => (
      options.dependencies.gateway.expireRunApprovals(options.runId)))
    this.approvalCoordinator = new AgentApprovalCoordinator({
      runId: options.runId,
      gateway: options.dependencies.gateway,
      getStatus: () => this.machine.status,
      getCurrentToolCallId: () => this.state.currentToolCallId,
      setCurrentToolCallId: (toolCallId) => { this.state.currentToolCallId = toolCallId },
      setWaitingApprovalId: (approvalId) => { this.state.waitingApprovalId = approvalId },
      transition: (status, reason) => this.transition(status, reason),
      setPausedFrom: (status) => this.pauseController.setPausedFrom(status),
      emit: (event) => this.emit(event),
      onAsyncError: (error) => this.handleAsyncEventError(error),
    })
    this.modelTurnCoordinator = new AgentModelTurnCoordinator({
      runId: options.runId,
      models: this.models,
      runModelStep: options.dependencies.runModelStep,
      recordUsage: (usage) => this.budget.recordModelUsage(usage),
      emit: (event) => this.emit(event),
      setCurrentModelRequestId: (requestId) => { this.currentModelRequestId = requestId },
      setCurrentStepId: (stepId) => { this.state.currentStepId = stepId },
      throwIfCancelled: () => this.throwIfCancelled(),
    })
    this.conversationCompactor = new AgentConversationCompactor({
      runId: options.runId,
      threadId: options.request.threadId,
      model: this.models.summarizer,
      conversation: this.conversation,
      sourceSequences: this.conversationSourceSequences,
      runModelStep: options.dependencies.runModelStep,
      signal: this.abortController.signal,
      appendSessionCompaction: options.dependencies.appendSessionCompaction,
      recordUsage: (usage) => this.budget.recordModelUsage(usage),
      setCurrentModelRequestId: (requestId) => { this.currentModelRequestId = requestId },
      throwIfCancelled: () => this.throwIfCancelled(),
    })
    this.toolExecutionCoordinator = new AgentToolExecutionCoordinator({
      runId: options.runId,
      threadId: options.request.threadId,
      approvalMode: options.request.approvalMode,
      supportsParallelTools: this.models.primary.capabilities.parallelTools,
      gateway: options.dependencies.gateway,
      registry: options.dependencies.registry,
      catalogPlanner: this.catalogPlanner,
      recoveryGuard: this.recoveryGuard,
      signal: this.abortController.signal,
      waitIfPaused: () => this.pauseController.wait(),
      throwIfCancelled: () => this.throwIfCancelled(),
      recordToolCall: (signature) => this.budget.recordToolCall(signature),
      recordProgress: (signature) => this.budget.recordProgress(signature),
      setActiveToolCall: (toolCallId) => this.pauseController.setActiveToolCall(toolCallId),
      requestApproval: (call, approval) => this.approvalCoordinator.request(call, approval),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        this.conversationJournal.appendInternal(
          'tool_result',
          toolMessage(call, observation),
          `tool:${call.toolCallId}`
        )
        this.recoveryGuard.observe(call, observation)
        if (this.recoveryGuard.consumeVerification(call, observation) && this.state.workingSummary) {
          this.state.workingSummary = markWorkingSummaryRecoveryVerified(this.state.workingSummary)
        }
      },
      emit: (event) => this.emit(event),
      onDiscoveredTools: (toolCallId, toolNames) => {
        logger.info('Agent 能力目录发现新工具', {
          event: 'agent_catalog.discovery.completed',
          requestId: options.runId,
          taskId: toolCallId,
          context: { toolNames },
        })
      },
    })
    this.savePointCoordinator = new AgentSavePointCoordinator({
      append: options.dependencies.appendSavePoint,
      getState: () => this.lifecycle.getState(),
      emit: (event) => this.emit(event),
    })
    this.turnContextCoordinator = new AgentTurnContextCoordinator({
      runId: options.runId,
      threadId: options.request.threadId,
      models: this.models,
      contextBuilder: new AgentContextBuilder(
        options.dependencies.artifactStore ?? new AgentArtifactStore()
      ),
      compactor: this.conversationCompactor,
      savePoints: this.savePointCoordinator,
      emit: (event) => this.emit(event),
    })
    this.externalWaitRegistration = new AgentExternalWaitRegistration({
      runId: options.runId,
      threadId: options.request.threadId,
      savePoints: this.savePointCoordinator,
      register: options.dependencies.registerExternalWait,
      transition: (status, reason) => this.transition(status, reason),
      emit: (event) => this.emit(event),
    })
    this.externalContinuation = new AgentExternalContinuationCoordinator({
      continuation: options.request.externalContinuation,
      registry: options.dependencies.registry,
      tools: this.toolExecutionCoordinator,
      savePoints: this.savePointCoordinator,
    })
  }
  start(): AgentRunState {
    if (this.started) return this.getState()
    this.started = true
    startAgentRun({
      runId: this.options.runId,
      request: this.options.request,
      models: this.models,
      emit: (event) => this.emit(event),
      transition: (reason) => this.transition('running', reason),
    })
    this.threadTitleCoordinator.start()
    this.externalContinuation.emitResumed((event) => this.emit(event))
    void this.execute()
    return this.getState()
  }
  getState(): AgentRunState { return this.lifecycle.getState() }
  getEventHistory(): ReturnType<AgentRunnerLifecycle['getEventHistory']> { return this.lifecycle.getEventHistory() }
  pause(reason = '用户暂停'): AgentRunState {
    this.pauseController.pause(reason)
    return this.getState()
  }
  resume(): AgentRunState {
    this.pauseController.resume()
    return this.getState()
  }
  cancel(reason = '用户取消'): AgentRunState {
    if (isTerminalAgentState(this.machine.status)) return this.getState()
    this.abortController.abort(reason)
    if (this.currentModelRequestId) this.options.dependencies.cancelModelStep(this.currentModelRequestId)
    this.terminalApprovalCleanup.start()
    this.approvalCoordinator.cancel()
    this.clarificationWaiter.cancel()
    this.pauseController.wake()
    this.transition('cancelled', reason)
    this.emit({ type: 'RunCancelled', reason, usage: this.budget.snapshot() })
    logger.info('Agent 运行已取消', {
      event: 'agent_runtime.run.cancelled', requestId: this.options.runId, context: { reason },
    })
    void Promise.all([
      this.terminalApprovalCleanup.wait(),
      this.conversationJournal.flush(),
    ]).then(() => {
      this.lifecycle.finishTerminal()
    }).catch((error: unknown) => {
      logger.error('取消运行时刷新会话消息失败', {
        event: 'agent_runtime.session.cancel_flush.failed',
        requestId: this.options.runId,
        error,
      })
      this.lifecycle.finishTerminal()
    })
    return this.getState()
  }
  async cancelAndWait(reason = '用户取消'): Promise<AgentRunState> {
    this.cancel(reason)
    await Promise.all([
      this.terminalApprovalCleanup.wait(),
      this.conversationJournal.flush(),
    ])
    return this.getState()
  }
  async respondApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<AgentRunState> {
    await this.approvalCoordinator.respond(approvalId, decision)
    return this.getState()
  }
  respondClarification(waitId: string, content: string): AgentRunState {
    if (!content.trim()) throw new Error('[CLARIFICATION_EMPTY] 澄清回答不能为空')
    if (!this.clarificationWaiter.settle(waitId, content.trim())) {
      throw new Error('[CLARIFICATION_NOT_WAITING] 回答不属于当前等待中的问题')
    }
    this.state.waitingClarificationId = null
    if (this.machine.status === 'waiting_user') this.transition('running', '用户已回答澄清问题')
    else if (this.machine.status === 'paused') this.pauseController.setPausedFrom('running')
    return this.getState()
  }
  private async execute(): Promise<void> {
    try {
      const snapshot = this.requireContext()
      const router = new AgentIntentRouter((goal, host, signal) => (
        this.modelTurnCoordinator.classify(goal, host, signal)
      ))
      const route = await router.route(this.options.runId, this.options.request.goal, snapshot, this.abortController.signal)
      this.emit({
        type: 'PlanUpdated',
        intent: route.intent,
        summary: route.reason,
        toolDomains: route.toolDomains,
      })
      while (!isTerminalAgentState(this.machine.status)) {
        await this.pauseController.wait()
        this.throwIfCancelled()
        await this.currentMessageConsumer.pull()
        const turn = this.budget.beginTurn()
        this.state.turn = turn
        const currentSnapshot = this.requireContext()
        const activation = this.externalContinuation.extendActivation(
          this.catalogPlanner.select(route, currentSnapshot),
          currentSnapshot
        )
        const registrations = activation.registrations
        logAgentToolActivation(this.options.runId, turn, currentSnapshot.revision, activation)
        const memoryContext = await this.memoryProvider.retrieve({
          goal: this.options.request.goal,
          snapshot: currentSnapshot,
          route,
          summary: this.state.workingSummary,
          signal: this.abortController.signal,
        })
        const preparedTurn = await this.turnContextCoordinator.prepare({
          turn,
          host: currentSnapshot,
          goal: this.options.request.goal,
          userInstructions: this.options.request.userInstructions,
          memoryContext,
          route,
          conversation: this.conversation,
          observations: this.observations,
          registrations,
          workingSummary: this.state.workingSummary,
          artifactRefs: this.state.workingSummary?.artifactRefs ?? [],
          approvalMode: this.options.request.approvalMode,
        })
        let { context } = preparedTurn
        const turnSnapshot = preparedTurn.snapshot
        const authoritativeContext = await this.externalContinuation.queryAuthoritativeStatus({
          snapshot: turnSnapshot,
          route,
          scopeRevisions: currentSnapshot.scopeRevisions,
          activeToolNames: context.activeToolNames,
          rebuild: preparedTurn.rebuild,
        })
        if (authoritativeContext) context = authoritativeContext
        let result: ModelStepResult | null = null
        let modelError: unknown | null = null
        try {
          result = await this.modelTurnCoordinator.runPrimary(turn, context)
        } catch (error) {
          if (
            isContextOverflowError(error)
            && this.state.currentToolCallId === null
            && this.state.workingSummary?.recovery.mode !== 'verify_before_write'
            && this.conversationCompactor.beginOverflowRecovery()
          ) {
            const semanticCompacted = await this.conversationCompactor.compact(turn, this.state.workingSummary)
            if (!semanticCompacted) {
              this.conversationCompactor.compactDeterministically(this.state.workingSummary)
            }
            context = preparedTurn.rebuild()
            try {
              result = await this.modelTurnCoordinator.runPrimary(turn, context, 'overflow-retry')
            } catch (retryError) {
              modelError = retryError
            }
          } else {
            modelError = error
          }
        }
        if (modelError || !result) {
          this.currentModelRequestId = null
          this.state.currentStepId = null
          this.throwIfCancelled()
          if (isContextOverflowError(modelError)) {
            throw new Error('[CONTEXT_OVERFLOW_AFTER_COMPACTION] 上下文压缩后仍超过模型限制，运行已停止')
          }
          throw modelError ?? new Error('[MODEL_STEP_EMPTY] 模型步骤未返回结果')
        }
        this.turnContextCoordinator.recordModelInputUsage(
          result.usage.inputTokens,
          this.conversation.length
        )
        for (const [index, message] of result.responseMessages.entries()) {
          this.conversationJournal.appendInternal(
            'model_message',
            message,
            `model:${result.stepId}:${index}`,
            {
              providerId: result.providerId,
              modelId: result.modelId,
              stepId: result.stepId,
              finishReason: result.finishReason,
              usage: result.usage,
            }
          )
        }
        await this.conversationJournal.flush()
        if (!this.modelOutputGuard.accept(result)) {
          this.budget.recordFailure()
          await this.conversationJournal.flush()
          continue
        }
        this.externalContinuation.assertNoResubmit(result.toolCalls)
        this.budget.recordSuccess()
        if (result.toolCalls.length > 0) {
          await this.savePointCoordinator.save('before_tools', turnSnapshot)
          await this.pauseController.wait()
          this.throwIfCancelled()
          const observationStart = this.observations.length
          await this.toolExecutionCoordinator.execute(
            result.toolCalls,
            route,
            currentSnapshot.scopeRevisions,
            new Set(context.activeToolNames)
          )
          await this.conversationJournal.flush()
          const recoveryGuidance = buildRecoveryGuidance(
            this.observations.slice(observationStart),
            this.options.dependencies.registry
          )
          if (recoveryGuidance) this.conversationJournal.appendEphemeral({
            role: 'user',
            content: recoveryGuidance,
          })
          await this.savePointCoordinator.save('after_tools', turnSnapshot)
          if (await this.externalWaitRegistration.registerIfSubmitted(
            this.observations.slice(observationStart),
            turnSnapshot
          )) {
            this.lifecycle.finishTerminal()
            return
          }
          continue
        }
        const finalText = result.text.trim() || (result.structuredOutput ? JSON.stringify(result.structuredOutput) : '')
        if (!finalText || (route.intent !== 'general' && this.observations.length === 0)) {
          this.budget.recordFailure()
          this.budget.recordProgress(`no-tool:${route.intent}:${result.finishReason}`)
          this.conversationJournal.appendEphemeral({
            role: 'user',
            content: '尚无网关工具结果证明任务完成。请调用合适工具，或明确说明无法执行的原因。',
          })
          continue
        }
        const completion = this.completionCoordinator.evaluate(
          route,
          finalText,
          this.observations
        )
        if (completion.kind === 'repair') {
          this.budget.recordFailure()
          this.budget.recordProgress(`verification:${completion.summary}`)
          this.conversationJournal.appendEphemeral({ role: 'user', content: completion.message })
          continue
        }
        if (completion.clarificationRequired) {
          const waitId = randomUUID()
          const answerPromise = this.clarificationWaiter.wait(waitId)
          this.state.waitingClarificationId = waitId
          this.transition('waiting_user', completion.summary)
          await this.savePointCoordinator.save('waiting_user', turnSnapshot)
          this.emit({
            type: 'ClarificationRequired',
            waitId,
            question: finalText,
            reason: completion.summary,
          })
          const answer = await answerPromise
          this.throwIfCancelled()
          if (!answer) throw new Error('[CLARIFICATION_CANCELLED] 澄清等待已取消')
          this.conversationJournal.appendEphemeral({ role: 'user', content: answer })
          continue
        }
        if (await this.currentMessageConsumer.pull() > 0) continue
        this.complete(finalText)
      }
    } catch (error) {
      if (this.machine.status !== 'cancelled') {
        try {
          await this.conversationJournal.flush()
        } catch (persistenceError) {
          await this.fail(persistenceError)
          return
        }
        await this.fail(this.takeAsyncEventError() ?? error)
      }
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
    this.approvalCoordinator.cancel()
    this.pauseController.wake()
  }
  private takeAsyncEventError(): unknown | null {
    const error = this.asyncEventError
    this.asyncEventError = null; return error
  }
  private complete(finalText: string): void { this.throwIfCancelled(); this.lifecycle.complete(finalText) }
  private async fail(error: unknown): Promise<void> {
    this.approvalCoordinator.cancel(); await this.terminalApprovalCleanup.run()
    if (this.machine.status !== 'cancelled') this.lifecycle.fail(error)
  }
  private transition(next: AgentRunStatus, reason?: string): void {
    this.lifecycle.transition(next, reason); if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
  private emit(input: AgentEventInput): void {
    this.lifecycle.emit(input); if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
}
