import { createMainLogger } from '../../logging'
import { randomUUID } from 'node:crypto'
import type {
  AgentEventInput,
  AgentRunPhase,
  AgentRunState,
  AgentRunStatus,
} from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentArtifactStore } from '../context/offload'
import { AgentContextBuilder } from '../context/builder'
import { AgentToolCatalogPlanner } from '../context/catalog'
import { AGENT_CORE_TOOL_NAMES } from '../context/tool-activation'
import { AgentToolGatewayError } from '../tools/gateway'
import {
  AgentRunMetrics,
  AgentStopPolicyExceededError,
  isBudgetExhaustionSoftLimit,
} from './budget'
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
import { readPendingVisualObservation } from '../../../../../src/core/assistant/surfaceObservation'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import {
  AGENT_INTENTS,
  AGENT_TOOL_DOMAINS,
  type AgentIntent,
  type AgentRouteDecision,
  type AgentToolDomain,
} from '../context/types'
import { deriveThreadContinuation } from '../context/thread-continuation'
const logger = createMainLogger('main.agent_runtime')

function isAgentIntent(value: string): value is AgentIntent {
  return (AGENT_INTENTS as readonly string[]).includes(value)
}

function isAgentToolDomain(value: string): value is AgentToolDomain {
  return (AGENT_TOOL_DOMAINS as readonly string[]).includes(value)
}

function restoreAgentRoute(
  recovered: NonNullable<AgentWorkingSummary['route']>
): AgentRouteDecision {
  const toolDomains = recovered.toolDomains.filter(isAgentToolDomain)
  return {
    routeVersion: 'agent-route/v2',
    intent: isAgentIntent(recovered.intent) ? recovered.intent : 'general',
    complexity: recovered.taskGraph ? 'multi_step' : 'simple',
    path: toolDomains.length > 0 ? 'workflow' : 'primary',
    toolDomains,
    source: 'fallback',
    reason: recovered.summary,
    taskFacets: recovered.taskGraph?.facets.map((facet) => facet.facetId),
    taskGraph: recovered.taskGraph,
  }
}

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
  private currentPhase: AgentRunPhase | null = null
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
    this.catalogPlanner.restoreLeases(this.conversation.flatMap((message) => {
      if (message.role !== 'tool' || !Array.isArray(message.content)) return []
      return message.content.flatMap((part) => {
        if (!Array.isArray(part.toolLeases)) return []
        return part.toolLeases.flatMap((rawLease) => {
          if (!rawLease || typeof rawLease !== 'object' || Array.isArray(rawLease)) return []
          const lease = rawLease as Record<string, unknown>
          if (typeof lease.facetId !== 'string' || !Array.isArray(lease.toolNames)) return []
          return [{
            facetId: lease.facetId,
            toolNames: lease.toolNames.filter((name): name is string => typeof name === 'string'),
          }]
        })
      })
    }))
    this.catalogPlanner.restoreLeases(
      options.recoveryContext?.toolLeases ?? [],
      options.recoveryContext?.toolLeaseCatalogRevision
    )
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
      onPhase: (phase) => this.setPhase(phase),
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
      recordToolCall: (signature, write) => this.budget.recordToolCall(signature, write),
      recordProgress: (signature) => this.budget.recordProgress(signature),
      recordFailure: () => this.budget.recordFailure(),
      recordSuccess: () => this.budget.recordSuccess(),
      setActiveToolCall: (toolCallId) => this.pauseController.setActiveToolCall(toolCallId),
      requestApproval: (call, approval) => this.approvalCoordinator.request(call, approval),
      onObservation: (call, observation) => {
        this.observations.push(observation)
        // 按观察契约而不是工具名识别：任何返回 visual_pending_model 且带合法附件的
        // 观察结果都会真正进入模型视野。绑死工具名会让新增观察能力静默拿不到像素，
        // 模型却以为自己“看过了”。
        const visual = agentAttachmentSchema.safeParse(readPendingVisualObservation(observation.output))
        if (visual.success) this.pendingVisualAttachments.push(visual.data)
        this.conversationJournal.appendInternal(
          'tool_result',
          toolMessage(call, observation, this.models.primary.limits.contextWindow),
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
        this.syncLeaseCheckpoint()
      },
      getProgressTracker: () => this.progressTracker,
      onProgressUpdated: () => this.syncLeaseCheckpoint(),
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
      onWaiting: () => this.setPhase('waiting_external'),
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
    if (this.options.budgetContinuation) {
      this.setPhase('continuing', `进入第 ${this.options.budgetContinuation.segment}/3 段执行`)
      this.emit({
        type: 'RunContinuationStarted',
        sourceRunId: this.options.budgetContinuation.sourceRunId,
        segment: this.options.budgetContinuation.segment,
        maxSegments: 3,
      })
    } else this.setPhase('planning')
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
      this.setPhase('planning')
      const recoveredRoute = this.options.recoveryContext?.route
      const route = recoveredRoute
        ? restoreAgentRoute(structuredClone(recoveredRoute))
        : await routeAgentGoal({
            runId: this.options.runId, goal: this.options.request.goal, snapshot,
            signal: this.abortController.signal,
            // 路由此前只看得到本轮那一句话和当前页面，同一线程里的"再帮我加一个…"必然被判成
            // 当前工作区的新任务。历史就在 options 里，没有理由不给路由用。
            continuation: deriveThreadContinuation(this.options.conversationHistory),
            classify: (goal, host, signal, continuation) => (
              this.modelTurnCoordinator.classify(goal, host, signal, continuation)
            ),
            emit: (event) => this.emit(event),
          })
      if (recoveredRoute?.taskGraph) {
        route.reason = `${route.reason}；已恢复上一执行段的 Task Graph 与 Effect Ledger`
        this.emit({
          type: 'PlanUpdated',
          intent: route.intent,
          summary: route.reason,
          toolDomains: route.toolDomains,
          taskGraph: route.taskGraph,
        })
      }
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
        ? new AgentFacetProgressTracker(
            route.taskGraph,
            this.options.dependencies.registry,
            route.complexity === 'multi_step',
            this.options.recoveryContext?.effectLedger,
            this.options.recoveryContext?.toolLeases.map((lease) => lease.facetId),
            route.continuationDomains
          ) : null
      this.setPhase('preparing')
      while (!isTerminalAgentState(this.machine.status)) {
        await this.pauseController.wait()
        this.throwIfCancelled()
        await this.currentMessageConsumer.pull()
        const turn = this.budget.beginTurn()
        this.state.turn = turn
        const softLimits = this.budget.consumeNewSoftLimits()
        if (softLimits.length > 0) {
          for (const code of softLimits) {
            this.emit({ type: 'BudgetSoftLimitReached', code, usage: this.budget.snapshot() })
          }
          const exhausted = softLimits.filter(isBudgetExhaustionSoftLimit)
          if (exhausted.length > 0) {
            this.catalogPlanner.enterCloseoutMode()
            this.conversationJournal.appendEphemeral({
              role: 'user',
              content: [
                '[HARNESS_CLOSEOUT_MODE]',
                '已达到软预算：禁止扩展新 Facet、无目标浏览和非必要能力发现。',
                '只执行已声明 action plan、结构化验证、补偿与最终收口；若现有计划不足，请立即保存检查点并说明阻塞，不得重复搜索。',
                '[END_HARNESS_CLOSEOUT_MODE]',
              ].join('\n'),
            })
          } else {
            // 质量信号只提醒换方法，不摘掉能力发现——任务还没做完，工具不能先被收走。
            this.conversationJournal.appendEphemeral({
              role: 'user',
              content: [
                '[HARNESS_PROGRESS_WARNING]',
                `最近几步没有产生新进展（${softLimits.join('、')}）。请换一种做法：读取真实状态、改用更匹配的能力，或向用户确认一个最小信息。`,
                '任务预算仍然充足，不要提前收尾，也不要重复刚才失败的调用。',
                '[END_HARNESS_PROGRESS_WARNING]',
              ].join('\n'),
            })
          }
        }
        const currentSnapshot = this.requireContext()
        this.setPhase('preparing')
        this.catalogPlanner.syncActiveFacets(this.progressTracker?.activeFacetIds() ?? [])
        this.syncLeaseCheckpoint()
        if (this.progressTracker && route.taskGraph) {
          route.taskGraph = this.progressTracker.taskGraphSnapshot()
          route.taskFacets = route.taskGraph.facets.map((facet) => facet.facetId)
        }
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
          protectedToolNames: activation.activeToolNames.filter((name) => (
            activation.leasedToolNames.includes(name)
            || (AGENT_CORE_TOOL_NAMES as readonly string[]).includes(name)
          )),
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
          this.setPhase(result.toolCalls.some((call) => (
            ['discover_application_capabilities', 'search_application_capabilities'].includes(call.toolName)
          )) ? 'discovering' : 'executing')
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
            saveAfter: () => {
              this.syncLeaseCheckpoint()
              return this.savePointCoordinator.save('after_tools', turnSnapshot)
            },
            registerExternalWait: (items) => this.externalWaitRegistration.registerIfSubmitted(items, turnSnapshot),
            // 有工具在等下一轮重新披露时不下发停止指令：否则"下一轮再给你"这个承诺永远兑现
            // 不了，模型只能带着一句"按规则需等下一轮披露"收工，而它其实已经知道该调什么了。
            progressGuidance: () => (
              this.catalogPlanner.hasPendingActivationRecovery()
                ? null
                : this.progressTracker?.settlementGuidance() ?? null
            ),
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
        this.setPhase('verifying')
        const completion = this.completionCoordinator.evaluate(
          route, finalText, this.observations, this.progressTracker?.settlement())
        if (completion.kind === 'repair') {
          this.budget.recordFailure()
          this.budget.recordProgress(`verification:${completion.summary}`)
          this.conversationJournal.appendEphemeral({ role: 'user', content: completion.message })
          continue
        }
        if (completion.clarificationRequired) {
          this.setPhase('blocked', completion.summary)
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
        const terminalError = this.takeAsyncEventError() ?? error
        if (terminalError instanceof AgentStopPolicyExceededError
          && terminalError.code.startsWith('MAX_')) {
          await this.exhaustBudget(terminalError)
          return
        }
        await this.fail(terminalError)
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
  private complete(finalText: string): void {
    this.throwIfCancelled()
    this.setPhase('completed')
    this.lifecycle.complete(finalText)
  }
  private async fail(error: unknown): Promise<void> {
    this.approvalCoordinator.cancel(); await this.terminalApprovalCleanup.run()
    if (this.machine.status !== 'cancelled') {
      this.setTerminalPhase('blocked')
      this.lifecycle.fail(error)
    }
  }
  private async exhaustBudget(error: AgentStopPolicyExceededError): Promise<void> {
    this.approvalCoordinator.cancel(); await this.terminalApprovalCleanup.run()
    if (this.machine.status !== 'cancelled') {
      this.setTerminalPhase('continuing', '当前执行段预算耗尽，正在保存并判断是否自动续跑')
      this.lifecycle.exhaustBudget(error.code, error)
    }
  }
  private setPhase(phase: AgentRunPhase, detail?: string): void {
    if (this.currentPhase === phase) return
    const previous = this.currentPhase
    this.currentPhase = phase
    this.emit({ type: 'RunPhaseChanged', phase, previous, detail })
  }
  /**
   * 终止路径必须保留触发终止的原始错误。阶段事件仍会进入事件流，但即使事件接收端
   * 已经故障，也不能让二次分发错误阻断 lifecycle 的终态落盘与 onTerminal 通知。
   */
  private setTerminalPhase(phase: AgentRunPhase, detail?: string): void {
    if (this.currentPhase === phase) return
    const previous = this.currentPhase
    this.currentPhase = phase
    this.lifecycle.emit({ type: 'RunPhaseChanged', phase, previous, detail })
  }
  private syncLeaseCheckpoint(): void {
    if (!this.state.workingSummary) return
    this.state.workingSummary = {
      ...this.state.workingSummary,
      toolLeases: this.catalogPlanner.currentLeaseSnapshot(),
      toolLeaseCatalogRevision: this.catalogPlanner.currentCatalogRevision(),
      effectLedger: this.progressTracker?.effectLedgerSnapshot()
        ?? this.state.workingSummary.effectLedger,
      updatedAt: new Date().toISOString(),
    }
  }
  private transition(next: AgentRunStatus, reason?: string): void {
    this.lifecycle.transition(next, reason); if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
  private emit(input: AgentEventInput): void {
    this.lifecycle.emit(input); if (!isTerminalAgentState(this.machine.status)) this.throwIfCancelled()
  }
}
