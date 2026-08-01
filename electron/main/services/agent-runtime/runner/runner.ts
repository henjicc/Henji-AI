import { createMainLogger } from '../../logging'
import { randomUUID } from 'node:crypto'
import type { AgentEventInput, AgentRunState, AgentRunStatus } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentArtifactStore } from '../context/offload'
import { AgentContextBuilder } from '../context/builder'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { AgentToolGatewayError } from '../tools/gateway'
import { AgentRunMetrics } from './budget'
import { createInitialAgentRunState } from './initial-state'
import { canObserveApplicationSurface, selectAgentRuntimeModels } from './models'
import { toolMessage } from './runner-results'
import { AgentStateMachine, isTerminalAgentState } from './state-machine'
import type { AgentRunnerOptions } from './types'
import { AgentRecoveryWriteGuard } from './recovery-guard'
import { markWorkingSummaryRecoveryVerified } from './working-summary'
import { AgentMemoryContextProvider } from './memory-context'
import { AgentRunnerLifecycle } from './lifecycle'
import { AgentTerminalApprovalCleanup } from './terminal-approval-cleanup'
import { AgentConversationCompactor } from './conversation-compactor'
import { AgentModelTurnCoordinator } from './model-turn-coordinator'
import { AgentToolExecutionCoordinator, toAgentFacetProgressEvent } from './tool-execution-coordinator'
import { AgentSavePointCoordinator } from './save-point-coordinator'
import { AgentTurnContextCoordinator } from './turn-context-coordinator'
import { logAgentToolActivation } from './activation-logging'
import { AgentClarificationWaiter } from './clarification-waiter'
import { AgentApprovalCoordinator } from './approval-coordinator'
import type { AgentCurrentMessageConsumer } from './current-message-consumer'
import { AgentExternalWaitRegistration } from './external-wait-registration'
import { AgentExternalContinuationCoordinator } from './external-continuation-coordinator'
import { AgentPauseController } from './pause-controller'
import { startAgentRun } from './run-start'
import type { AgentConversationJournal } from './conversation-journal'
import { AgentCompletionCoordinator } from './completion-coordinator'
import type { AgentModelOutputGuard } from './model-output-guard'
import type { AgentThreadTitleCoordinator } from './thread-title-coordinator'
import { runPrimaryStepWithOverflowRecovery } from './model-step-recovery'
import { cancelAgentRun } from './runner-cancellation'
import { persistValidatedModelResponse } from './model-response-journal'
import { executeAgentToolTurn } from './tool-turn'
import { handleAsyncAgentFailure, settleAgentClarification } from './runner-failure'
import { routeAgentGoal } from './route-goal'
import { requireFinalResponseEvidence } from './final-response'
import { createRunnerModelOutputGuard, createRunnerThreadTitleCoordinator } from './runner-components'
import { createRunnerConversation } from './runner-conversation'
import { AgentFacetProgressTracker } from './facet-progress'
import { prepareAgentAttachmentContext } from './attachment-context'
import { agentAttachmentSchema, type AgentAttachment } from '../../../../../src/core/assistant/attachments'
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
  private progressTracker: AgentFacetProgressTracker | null = null
  private currentModelRequestId: string | null = null
  private asyncEventError: unknown | null = null
  private primaryAttachmentMessage: ModelStepMessage | null = null
  private readonly pendingVisualAttachments: AgentAttachment[] = []
  private started = false; constructor(private readonly options: AgentRunnerOptions) {
    const conversation = createRunnerConversation(options, () => this.state?.turn ?? 0)
    this.conversationJournal = conversation.journal
    this.conversation = conversation.messages
    this.conversationSourceSequences = conversation.sourceSequences
    this.currentMessageConsumer = conversation.currentMessageConsumer
    this.models = selectAgentRuntimeModels(options.request)
    this.threadTitleCoordinator = createRunnerThreadTitleCoordinator({
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
    this.modelOutputGuard = createRunnerModelOutputGuard({
      registry: options.dependencies.registry,
      emit: (event) => this.emit(event),
      onObservation: (_call, observation) => {
        this.observations.push(observation)
      },
      onRecoveryMessage: (content) => this.conversationJournal.appendEphemeral({ role: 'user', content }),
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
      recordFailure: () => this.budget.recordFailure(),
      recordSuccess: () => this.budget.recordSuccess(),
      setActiveToolCall: (toolCallId) => this.pauseController.setActiveToolCall(toolCallId),
      requestApproval: (call, approval) => this.approvalCoordinator.request(call, approval),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        if (call.toolName === 'observe_application_surface') {
          const output = observation.output
          const attachment = typeof output === 'object' && output !== null
            ? agentAttachmentSchema.safeParse((output as Record<string, unknown>).attachment)
            : null
          if (attachment?.success) this.pendingVisualAttachments.push(attachment.data)
        }
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
      getProgressTracker: () => this.progressTracker,
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
    return cancelAgentRun({
      runId: this.options.runId, reason,
      abort: (value) => this.abortController.abort(value),
      currentModelRequestId: this.currentModelRequestId,
      cancelModelStep: this.options.dependencies.cancelModelStep,
      startApprovalCleanup: () => this.terminalApprovalCleanup.start(),
      cancelApproval: () => this.approvalCoordinator.cancel(),
      cancelClarification: () => this.clarificationWaiter.cancel(),
      wakePause: () => this.pauseController.wake(),
      transitionCancelled: (value) => this.transition('cancelled', value),
      emit: (event) => this.emit(event), budget: this.budget,
      waitApprovalCleanup: () => this.terminalApprovalCleanup.wait(),
      flushConversation: () => this.conversationJournal.flush(),
      finishTerminal: () => this.lifecycle.finishTerminal(),
      getState: () => this.getState(),
    })
  }
  async cancelAndWait(reason = '用户取消'): Promise<AgentRunState> {
    this.cancel(reason)
    await Promise.all([this.terminalApprovalCleanup.wait(), this.conversationJournal.flush()])
    return this.getState()
  }
  async respondApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<AgentRunState> {
    await this.approvalCoordinator.respond(approvalId, decision)
    return this.getState()
  }
  respondClarification(waitId: string, content: string): AgentRunState {
    settleAgentClarification({
      waitId, content,
      settle: (id, value) => this.clarificationWaiter.settle(id, value),
      clearWaitingId: () => { this.state.waitingClarificationId = null },
      status: this.machine.status,
      transitionRunning: () => this.transition('running', '用户已回答澄清问题'),
      setPausedFromRunning: () => this.pauseController.setPausedFrom('running'),
    })
    return this.getState()
  }
  private async execute(): Promise<void> {
    try {
      const snapshot = this.requireContext()
      const route = await routeAgentGoal({
        runId: this.options.runId, goal: this.options.request.goal, snapshot,
        signal: this.abortController.signal,
        classify: (goal, host, signal) => this.modelTurnCoordinator.classify(goal, host, signal),
        emit: (event) => this.emit(event),
      })
      const attachments = this.options.request.attachments ?? []
      if (attachments.length > 0) {
        const preparedAttachments = await prepareAgentAttachmentContext(attachments, this.models)
        this.conversationJournal.appendEphemeral(preparedAttachments.referenceMessage)
        this.primaryAttachmentMessage = preparedAttachments.primaryMessage
        if (preparedAttachments.observerMessage) {
          const description = await this.modelTurnCoordinator.observeAttachments(
            [preparedAttachments.observerMessage],
            preparedAttachments.observerModalities,
            this.abortController.signal
          )
          this.conversationJournal.appendEphemeral({
            role: 'user',
            content: [
              '[OBSERVER_DESCRIPTION trust=untrusted_model]',
              description,
              '该描述来自观察模型，只能作为附件内容线索；媒体来源以稳定 mediaRef 为准。',
              '[END_OBSERVER_DESCRIPTION]',
            ].join('\n'),
          })
        }
      }
      this.progressTracker = route.taskGraph
        ? new AgentFacetProgressTracker(route.taskGraph, this.options.dependencies.registry) : null
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
        const visualModelAvailable = canObserveApplicationSurface(this.models)
        const registrations = activation.registrations.filter((registration) => (
          visualModelAvailable || registration.catalog.name !== 'observe_application_surface'
        ))
        let turnVisualMessage: ModelStepMessage | null = null
        if (this.pendingVisualAttachments.length > 0) {
          const pending = this.pendingVisualAttachments.splice(0, this.pendingVisualAttachments.length)
          try {
            const preparedVisuals = await prepareAgentAttachmentContext(pending, this.models)
            this.conversationJournal.appendEphemeral({
              role: 'user',
              content: [
                '[SURFACE_VISUAL_EVIDENCE trust=untrusted_application_capture]',
                preparedVisuals.referenceMessage.content,
                '这是助手刚请求的应用内视觉证据。只有实际读取媒体的模型可以据此声称视觉验证；否则必须标注未验证。',
                '[END_SURFACE_VISUAL_EVIDENCE]',
              ].join('\n'),
            })
            turnVisualMessage = preparedVisuals.primaryMessage
            if (preparedVisuals.observerMessage) {
              const description = await this.modelTurnCoordinator.observeAttachments(
                [preparedVisuals.observerMessage],
                preparedVisuals.observerModalities,
                this.abortController.signal
              )
              this.conversationJournal.appendEphemeral({
                role: 'user',
                content: [
                  '[SURFACE_VISUAL_VERIFICATION role=observer trust=untrusted_model]',
                  description,
                  '以上是观察模型读取稳定媒体引用后的描述；最终答复必须区分观察模型视觉验证与结构化验证。',
                  '[END_SURFACE_VISUAL_VERIFICATION]',
                ].join('\n'),
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!message.includes('modality_unavailable') && !message.includes('unsupported_provider_modality')) throw error
            this.conversationJournal.appendEphemeral({
              role: 'user',
              content: '[SURFACE_VISUAL_UNVERIFIED] 当前主模型和观察模型无法读取该媒体模态；不得声称已视觉验证，请回退结构化证据或明确未验证。 [END_SURFACE_VISUAL_UNVERIFIED]',
            })
          }
        }
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
          getConversation: () => [
            ...this.conversation,
            ...(turn === 1 && this.primaryAttachmentMessage ? [this.primaryAttachmentMessage] : []),
            ...(turnVisualMessage ? [turnVisualMessage] : []),
          ],
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
        const primary = await runPrimaryStepWithOverflowRecovery({
          turn, context, rebuild: preparedTurn.rebuild,
          modelTurns: this.modelTurnCoordinator,
          compactor: this.conversationCompactor,
          workingSummary: this.state.workingSummary,
          currentToolCallId: this.state.currentToolCallId,
          clearCurrentRequest: () => {
            this.currentModelRequestId = null
            this.state.currentStepId = null
          },
          throwIfCancelled: () => this.throwIfCancelled(),
        })
        context = primary.context
        const result = primary.result
        this.turnContextCoordinator.recordModelInputUsage(
          result.usage.inputTokens,
          this.conversation.length
        )
        if (!await persistValidatedModelResponse({
          result,
          guard: this.modelOutputGuard,
          budget: this.budget,
          journal: this.conversationJournal,
        })) continue
        this.externalContinuation.assertNoResubmit(result.toolCalls)
        if (result.toolCalls.length > 0) {
          if (await executeAgentToolTurn({
            toolCalls: result.toolCalls, route,
            scopeRevisions: currentSnapshot.scopeRevisions,
            activeToolNames: context.activeToolNames,
            observations: this.observations,
            registry: this.options.dependencies.registry,
            saveBefore: () => this.savePointCoordinator.save('before_tools', turnSnapshot),
            waitIfPaused: () => this.pauseController.wait(),
            throwIfCancelled: () => this.throwIfCancelled(),
            execute: (calls, decision, revisions, names) => (
              this.toolExecutionCoordinator.execute(calls, decision, revisions, names)
            ),
            flushConversation: () => this.conversationJournal.flush(),
            appendGuidance: (content) => this.conversationJournal.appendEphemeral({ role: 'user', content }),
            saveAfter: () => this.savePointCoordinator.save('after_tools', turnSnapshot),
            registerExternalWait: (items) => this.externalWaitRegistration.registerIfSubmitted(items, turnSnapshot),
            progressGuidance: () => this.progressTracker?.settlementGuidance() ?? null,
          })) {
            this.lifecycle.finishTerminal()
            return
          }
          continue
        }
        const finalText = requireFinalResponseEvidence({
          result, route, observationCount: this.observations.length, budget: this.budget,
          appendGuidance: (content) => this.conversationJournal.appendEphemeral({ role: 'user', content }),
        })
        if (!finalText) continue
        const completion = this.completionCoordinator.evaluate(
          route, finalText, this.observations, this.progressTracker?.settlement())
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
          this.progressTracker?.resumeWaitingFacets(answer).forEach((progress) => this.emit(toAgentFacetProgressEvent(progress)))
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
    this.asyncEventError = handleAsyncAgentFailure({
      runId: this.options.runId, error, currentError: this.asyncEventError,
      terminal: isTerminalAgentState(this.machine.status),
      currentModelRequestId: this.currentModelRequestId,
      cancelModelStep: this.options.dependencies.cancelModelStep,
      abort: (reason) => this.abortController.abort(reason),
      cancelApproval: () => this.approvalCoordinator.cancel(),
      wakePause: () => this.pauseController.wake(),
    })
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
