import { webContents, type WebContents } from 'electron'

import {
  agentRunSnapshotSchema,
  agentRuntimeEventPayloadSchema,
  type AgentRunEventsPage,
  type AgentRunSnapshot,
  type AgentStartRunRequest,
  type AgentStartRunResult,
  type AgentBudgetContinuation,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentRunSummary } from '../../../../src/core/assistant/persistence'
import {
  agentDeleteThreadsResultSchema,
  type AgentDeleteThreadsRequest,
  type AgentDeleteThreadsResult,
  type AgentThreadSummary,
  type AgentTranscriptPage,
} from '../../../../src/core/assistant/session'
import {
  type AgentEnqueueMessageRequest,
  type AgentEnqueueMessageResult,
  type AgentCancelQueuedMessageRequest,
  type AgentSessionEntry,
} from '../../../../src/core/assistant/session'
import type { AgentEvent, AgentRunState } from '../../../../src/core/assistant/events'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import {
  agentArtifactDescribeRequestSchema,
  agentArtifactReadRequestSchema,
  type AgentArtifactDescriptor,
  type AgentArtifactPage,
} from '../../../../src/core/assistant/artifacts'
import {
  agentMemoryRetrievalQuerySchema,
  type AgentMemoryRetrievalResult,
} from '../../../../src/core/assistant/memory'
import { getAssistantHostContext } from '../assistant/frontend-tool-bridge'
import { getDb } from '../db'
import { getLlmProviderApiKey } from '../keystore'
import { getAgentMemoryStore } from '../assistant/memory'
import { AgentRuntimeManager } from '../agent-runtime-manager/manager'
import {
  createMainLogger,
  getAgentTraceCaptureMode,
  getAgentTraceStore,
} from '../logging'
import { AgentPersistenceStore } from './persistence/store'
import { buildAgentRunEventsPage } from './persistence/event-store'
import { AgentPermissionAuditStore } from './persistence/permission-audit-store'
import { appendValidatedSessionCompaction } from './persistence/session-compaction-append'
import { appendValidatedSessionInternal } from './persistence/session-internal-append'
import { appendValidatedSavePoint } from './persistence/save-point-append'
import type { AgentPermissionAuditRecord } from '../../../../src/core/assistant/permissionAudit'
import { createBuiltinAgentToolRegistry } from './tools/builtin'
import { artifactPayloadSchema } from './runtime-schemas'
import { settleRuntimeRun } from './runtime-settlement'
import { AgentMessageQueueCoordinator } from './message-queue-coordinator'
import type {
  AgentCancelExternalWaitRequest,
  GenerationStatusReportRequest,
} from '../../../../src/core/assistant/externalWait'
import { executeAgentToolInMain, invokeAgentFrontendTool } from './host-bridge'
import { AgentExternalWaitRuntime } from './external-wait-runtime'
import { startRuntimeRun, type AgentRunRecord } from './runtime-run-starter'
import { decideAgentBudgetContinuation } from './runner/job-budget'
import {
  agentThreadTitleContextRequestSchema,
  agentThreadTitleUpdateSchema,
} from '../../../../src/core/assistant/threadTitle'
const logger = createMainLogger('main.agent_runtime')

export type AgentRunEventListener = (event: AgentEvent) => void

export class AgentRuntimeService {
  private readonly runs = new Map<string, AgentRunRecord>()
  private readonly activeByThread = new Map<string, string>()
  private readonly eventListeners = new Map<string, Set<AgentRunEventListener>>()
  private readonly persistence = new AgentPersistenceStore(getDb())
  private readonly permissionAudit = new AgentPermissionAuditStore(getDb())
  private readonly agentTraceStore = getAgentTraceStore()
  private readonly memory = getAgentMemoryStore()
  private readonly registry = createBuiltinAgentToolRegistry(
    (operation, context) => invokeAgentFrontendTool(
      operation, context, (runId) => this.runs.get(runId)
    ),
    {
      describe: (request) => this.persistence.describeArtifact(request),
      read: (request) => this.persistence.readArtifact(request),
    }
  )
  private readonly manager = new AgentRuntimeManager({
    getModelApiKey: getLlmProviderApiKey,
    executeTool: (payload, signal) => executeAgentToolInMain(
      payload, signal, this.registry, (runId) => this.runs.get(runId)
    ),
    saveArtifact: (payload) => this.saveArtifact(payload),
    describeArtifact: (payload) => this.describeArtifact(payload),
    readArtifact: (payload) => this.readArtifact(payload),
    retrieveMemory: (payload) => this.retrieveMemory(payload),
    onEvent: (runId, event) => this.onRunEvent(runId, event),
    onCheckpoint: (runId, state) => this.onCheckpoint(runId, state),
    onTerminal: (runId, state) => this.onTerminal(runId, state),
    onProcessFailure: (runIds, reason) => this.onProcessFailure(runIds, reason),
    getAgentTraceCaptureMode,
    startAgentTrace: (payload) => this.agentTraceStore.start(payload),
    completeAgentTrace: (payload) => this.agentTraceStore.complete(payload),
    failAgentTrace: (payload) => this.agentTraceStore.fail(payload),
    appendPermissionAudit: (payload) => {
      const record = this.permissionAudit.append(payload)
      return { auditId: record.auditId }
    },
    appendSessionInternal: (payload) => appendValidatedSessionInternal(
      payload,
      (runId) => this.runs.get(runId),
      this.persistence
    ),
    appendSessionCompaction: (payload) => appendValidatedSessionCompaction(
      payload,
      (runId) => this.runs.get(runId),
      this.persistence
    ),
    appendSavePoint: (payload) => appendValidatedSavePoint(
      payload,
      (runId) => this.runs.get(runId)?.threadId,
      this.persistence
    ),
    consumeCurrentTaskMessages: (payload) => {
      const runId = typeof payload === 'object' && payload ? Reflect.get(payload, 'runId') : null
      if (typeof runId !== 'string' || !this.runs.has(runId)) {
        throw new Error('[PERMISSION_DENIED] 队列消费不属于当前 run')
      }
      return this.persistence.consumeCurrentTaskMessages(runId)
    },
    getThreadTitleContext: (payload) => this.persistence.threadTitles.getContext(
      agentThreadTitleContextRequestSchema.parse(payload)
    ),
    updateThreadTitle: (payload) => this.persistence.threadTitles.update(
      agentThreadTitleUpdateSchema.parse(payload)
    ),
    registerExternalWait: (payload) => this.externalWait.register(payload),
  })
  private readonly messageQueue = new AgentMessageQueueCoordinator({
    persistence: this.persistence,
    manager: this.manager,
    commitControlState: (runId, state) => this.commitControlState(runId, state),
    startContinuation: (owner, request, parentRunId, recoveryContext) => (
      this.startRunWithParent(owner, request, parentRunId, recoveryContext)
    ),
    hasActiveThread: (threadId) => this.activeByThread.has(threadId),
  })
  private readonly externalWait = new AgentExternalWaitRuntime({
    persistence: this.persistence,
    hasActiveThread: (threadId) => this.activeByThread.has(threadId),
    startContinuation: (owner, request, parentRunId, recoveryContext) => (
      this.startRunWithParent(owner, request, parentRunId, recoveryContext)
    ),
  })
  constructor() { this.persistence.markInterruptedRuns() }

  async startRun(owner: WebContents, request: AgentStartRunRequest): Promise<AgentStartRunResult> {
    return this.startRunWithParent(owner, request, null, undefined) }
  private async startRunWithParent(
    owner: WebContents,
    request: AgentStartRunRequest,
    parentRunId: string | null,
    recoveryContext: AgentWorkingSummary | undefined,
    budgetContinuation?: AgentBudgetContinuation
  ): Promise<AgentStartRunResult> {
    return startRuntimeRun({
      owner, request, parentRunId, recoveryContext, budgetContinuation,
      runs: this.runs,
      activeByThread: this.activeByThread,
      persistence: this.persistence,
      memory: this.memory,
      manager: this.manager,
    })
  }

  async enqueueMessage(
    owner: WebContents,
    raw: AgentEnqueueMessageRequest
  ): Promise<AgentEnqueueMessageResult> {
    return this.messageQueue.enqueue(this.resolveQueueRun(owner, raw.runId), raw)
  }

  cancelQueuedMessage(owner: WebContents, raw: AgentCancelQueuedMessageRequest): AgentSessionEntry {
    return this.messageQueue.cancel(this.resolveQueueRun(owner, raw.runId), raw)
  }

  async reportGenerationStatus(
    owner: WebContents,
    request: GenerationStatusReportRequest
  ): Promise<void> {
    await this.externalWait.report(owner, request)
  }

  async cancelExternalWait(
    owner: WebContents,
    request: AgentCancelExternalWaitRequest
  ): Promise<AgentRunState> {
    return this.externalWait.cancel(owner, request)
  }

  async cancelRun(owner: WebContents, runId: string, reason: string): Promise<AgentRunState> {
    this.requireOwnedRun(owner, runId)
    return this.commitControlState(runId, await this.manager.cancelRun(runId, reason))
  }

  async pauseRun(owner: WebContents, runId: string): Promise<AgentRunState> {
    this.requireOwnedRun(owner, runId)
    return this.commitControlState(runId, await this.manager.pauseRun(runId))
  }

  async resumeRun(owner: WebContents, runId: string): Promise<AgentRunState> {
    this.requireOwnedRun(owner, runId)
    return this.commitControlState(runId, await this.manager.resumeRun(runId))
  }

  async respondApproval(
    owner: WebContents,
    runId: string,
    approvalId: string,
    decision: 'approve' | 'reject'
  ): Promise<AgentRunState> {
    this.requireOwnedRun(owner, runId)
    return this.commitControlState(
      runId,
      await this.manager.respondApproval(runId, approvalId, decision)
    )
  }

  getRunState(owner: WebContents, runId: string): AgentRunState {
    const live = this.runs.get(runId)
    if (live) {
      this.requireRebindableRun(owner, runId)
      return live.state
    }
    const persisted = this.persistence.loadState(runId)
    if (!persisted) throw new Error('[run_not_found] 运行不存在')
    return persisted
  }

  getRunSnapshot(owner: WebContents, runId: string): AgentRunSnapshot {
    const live = this.runs.get(runId)
    if (live) {
      const record = this.requireRebindableRun(owner, runId)
      return agentRunSnapshotSchema.parse({ state: record.state, events: record.events })
    }
    const state = this.persistence.loadState(runId)
    if (!state) throw new Error('[run_not_found] 运行不存在')
    return agentRunSnapshotSchema.parse({
      state,
      events: this.persistence.loadEvents(runId),
    })
  }

  getRunEvents(
    owner: WebContents,
    runId: string,
    afterSequence: number,
    limit: number
  ): AgentRunEventsPage {
    const live = this.runs.get(runId)
    const state = live
      ? this.requireRebindableRun(owner, runId).state
      : this.persistence.loadState(runId)
    if (!state) throw new Error('[run_not_found] 运行不存在')

    const stored = this.persistence.loadEventsAfter(runId, afterSequence, limit)
    const page = buildAgentRunEventsPage(runId, afterSequence, state, stored)
    if (page.hasGap) {
      logger.warn('Agent 事件增量补拉检测到缺口', {
        event: 'agent_runtime.events.gap.detected',
        requestId: runId,
        context: {
          afterSequence,
          firstSequence: stored.events[0]?.sequence ?? null,
          oldestSequence: page.oldestSequence,
          latestSequence: page.latestSequence,
        },
      })
    }
    return page
  }

  subscribeRunEvents(owner: WebContents, runId: string, listener: AgentRunEventListener): () => void {
    this.requireRebindableRun(owner, runId)
    const listeners = this.eventListeners.get(runId) ?? new Set<AgentRunEventListener>()
    listeners.add(listener)
    this.eventListeners.set(runId, listeners)
    return () => {
      const current = this.eventListeners.get(runId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.eventListeners.delete(runId)
    }
  }

  listRuns(threadId?: string, limit = 30): AgentRunSummary[] {
    return this.persistence.listRuns(threadId, limit)
  }

  listThreads(limit = 30): AgentThreadSummary[] {
    return this.persistence.listThreads(limit)
  }

  deleteThreads(request: AgentDeleteThreadsRequest): AgentDeleteThreadsResult {
    logger.info('开始删除 Agent 对话', {
      event: 'agent_runtime.threads.delete.start',
      requestId: request.requestId,
      context: { requestedCount: request.threadIds.length },
    })
    try {
      const activeThreadIds = request.threadIds.filter((threadId) => (
        this.activeByThread.has(threadId)
        || this.persistence.externalWait.hasPendingThread(threadId)
      ))
      const activeThreadIdSet = new Set(activeThreadIds)
      const deletedThreadIds = this.persistence.threadDeletion.delete(
        request.threadIds.filter((threadId) => !activeThreadIdSet.has(threadId))
      )
      const result = agentDeleteThreadsResultSchema.parse({
        deletedThreadIds,
        activeThreadIds,
      })
      logger.info('Agent 对话删除完成', {
        event: 'agent_runtime.threads.delete.completed',
        requestId: request.requestId,
        context: {
          deletedCount: result.deletedThreadIds.length,
          activeCount: result.activeThreadIds.length,
        },
      })
      return result
    } catch (error) {
      logger.error('Agent 对话删除失败', {
        event: 'agent_runtime.threads.delete.failed',
        requestId: request.requestId,
        context: {
          requestedCount: request.threadIds.length,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  getTranscript(
    owner: WebContents,
    threadId: string,
    afterSequence = 0,
    limit = 100
  ): AgentTranscriptPage {
    void this.messageQueue.resume(owner, threadId)
    void this.externalWait.resumeThread(owner, threadId)
    return this.persistence.loadTranscript(threadId, afterSequence, limit)
  }

  queryPermissionAudit(
    runId: string,
    toolCallId?: string,
    limit = 500
  ): AgentPermissionAuditRecord[] {
    return this.permissionAudit.query({ runId, toolCallId, limit })
  }

  async retryRun(
    owner: WebContents,
    runId: string,
    userInstructions?: string
  ): Promise<AgentStartRunResult> {
    const request = this.persistence.loadRequest(runId)
    const previous = this.persistence.loadState(runId)
    if (!request || !previous) throw new Error('[run_not_found] 运行不存在')
    if (!['completed', 'budget_exhausted', 'failed', 'cancelled'].includes(previous.status)) {
      throw new Error('[run_not_retryable] 活动任务不能重复启动')
    }
    const result = await this.startRunWithParent(owner, {
      ...request,
      userInstructions,
    }, runId, previous.workingSummary)
    this.persistence.markRetried(runId)
    return result
  }

  async dispose(): Promise<void> {
    this.externalWait.dispose()
    await this.manager.dispose()
  }

  private commitControlState(runId: string, state: AgentRunState): AgentRunState {
    this.updateState(runId, state)
    this.persistence.saveState(state)
    return state
  }

  private onRunEvent(runId: string, event: AgentEvent): void {
    const record = this.runs.get(runId)
    if (!record) return
    record.events.push(event)
    if (record.events.length > 2_000) record.events.shift()
    this.persistence.appendEvent(event)
    this.notifyRunEventListeners(runId, event)
    this.sendEvent(record, runId, event)
  }

  private onCheckpoint(runId: string, state: AgentRunState): void {
    this.updateState(runId, state)
    this.persistence.saveState(state)
  }

  private onTerminal(runId: string, state: AgentRunState): void {
    const record = this.runs.get(runId)
    const terminalOwner = record ? webContents.fromId(record.ownerWebContentsId) : null
    const terminalRequest = state.status === 'budget_exhausted'
      ? this.persistence.loadRequest(runId)
      : null
    const continuation = state.status === 'budget_exhausted'
      && record
      && terminalRequest
      && terminalOwner
      && !terminalOwner.isDestroyed()
      ? this.resolveBudgetContinuation(runId, state, terminalRequest)
      : null
    const terminalState = state.status !== 'budget_exhausted'
      ? state
      : continuation?.decision.allowed
        ? { ...state, error: null, updatedAt: new Date().toISOString() }
        : this.withStoppedContinuationError(
            state,
            continuation?.decision.reason ?? '运行宿主已不可用，无法安全创建下一段执行'
          )
    this.updateState(runId, terminalState)
    if (terminalState.status === 'failed' || terminalState.status === 'cancelled') {
      this.persistence.cancelCurrentTaskMessages(runId, '原任务已终止，未消费的当前任务补充已取消')
    }
    settleRuntimeRun({
      runId, state: terminalState, record, persistence: this.persistence,
      activeByThread: this.activeByThread,
      eventListeners: this.eventListeners,
      runs: this.runs,
    })
    if (continuation?.decision.allowed && continuation.decision.budget
      && terminalOwner && terminalRequest) {
      void this.continueBudgetExhaustedRun(
        terminalOwner,
        runId,
        terminalRequest,
        state,
        continuation.nextSegment,
        continuation.decision.budget
      )
      return
    }
    if (record && terminalState.status === 'waiting_external') {
      const owner = webContents.fromId(record.ownerWebContentsId)
      if (owner && !owner.isDestroyed()) void this.externalWait.sourceSettled(owner, runId)
    } else if (record) {
      const owner = webContents.fromId(record.ownerWebContentsId)
      if (owner && !owner.isDestroyed()) {
        void this.messageQueue.settle(owner, runId, terminalState)
      }
    }
  }

  private resolveBudgetContinuation(
    sourceRunId: string,
    sourceState: AgentRunState,
    request: AgentStartRunRequest
  ) {
    const states: AgentRunState[] = [sourceState]
    let cursorRunId = sourceRunId
    let currentSegment = 1
    const visited = new Set([sourceRunId])
    for (;;) {
      const continuation = [...this.persistence.loadEvents(cursorRunId)]
        .reverse()
        .find((event) => event.type === 'RunContinuationStarted')
      if (!continuation || continuation.type !== 'RunContinuationStarted') break
      currentSegment = Math.max(currentSegment, continuation.segment)
      if (visited.has(continuation.sourceRunId)) break
      visited.add(continuation.sourceRunId)
      const parentState = this.persistence.loadState(continuation.sourceRunId)
      if (!parentState) break
      states.unshift(parentState)
      cursorRunId = continuation.sourceRunId
    }
    const nextSegment = currentSegment + 1
    const decision = decideAgentBudgetContinuation(states, nextSegment, request.budget)
    if (!decision.allowed) {
      logger.warn('Agent Job 自动续跑已停止', {
        event: 'agent_runtime.job.continuation.blocked',
        requestId: sourceRunId,
        context: { segment: currentSegment, reason: decision.reason ?? '预算不足' },
      })
    }
    return { decision, nextSegment }
  }

  private withStoppedContinuationError(
    sourceState: AgentRunState,
    reason: string
  ): AgentRunState {
    return {
      ...sourceState,
      error: {
        code: 'JOB_BUDGET_EXHAUSTED',
        message: `本次任务已停止自动续跑：${reason}。如需继续，请明确发起新的任务。`,
        retryable: false,
        recovery: 'user_action',
      },
      updatedAt: new Date().toISOString(),
    }
  }

  private async continueBudgetExhaustedRun(
    owner: WebContents,
    sourceRunId: string,
    request: AgentStartRunRequest,
    sourceState: AgentRunState,
    nextSegment: number,
    budget: NonNullable<ReturnType<typeof decideAgentBudgetContinuation>['budget']>
  ): Promise<void> {
    try {
      await this.startRunWithParent(
        owner,
        { ...request, budget },
        sourceRunId,
        sourceState.workingSummary,
        { sourceRunId, segment: nextSegment }
      )
    } catch (error) {
      const stoppedState: AgentRunState = {
        ...sourceState,
        error: {
          code: 'RUN_CONTINUATION_FAILED',
          message: '自动续跑启动失败；Effect Ledger 和工具租约已经保存在检查点，请明确重试该任务。',
          retryable: true,
          recovery: 'user_action',
        },
        updatedAt: new Date().toISOString(),
      }
      this.persistence.saveState(stoppedState)
      this.persistence.appendTerminalMessage(stoppedState)
      logger.error('Agent Job 自动续跑启动失败', {
        event: 'agent_runtime.job.continuation.failed',
        requestId: sourceRunId,
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }


  private onProcessFailure(runIds: string[], reason: string): void {
    this.agentTraceStore.markInterrupted(runIds)
    for (const runId of runIds) {
      const record = this.runs.get(runId)
      const state = this.persistence.markRunRecoveryRequired(
        runId,
        `${reason}；未知状态的工具调用不会自动重放，请确认后重试`
      )
      if (!state) continue
      this.updateState(runId, state)
      if (record && this.activeByThread.get(record.threadId) === runId) {
        this.activeByThread.delete(record.threadId)
      }
      const events = this.persistence.loadEvents(runId)
      const terminalEvent = events[events.length - 1]
      if (record && terminalEvent) {
        record.events = events
        this.notifyRunEventListeners(runId, terminalEvent)
        this.sendEvent(record, runId, terminalEvent)
      }
      this.eventListeners.delete(runId)
    }
  }

  private updateState(runId: string, state: AgentRunState): void {
    const record = this.runs.get(runId)
    if (record) record.state = state
  }

  private notifyRunEventListeners(runId: string, event: AgentEvent): void {
    const listeners = this.eventListeners.get(runId)
    if (!listeners) return
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // 命令行或诊断订阅者异常不能中断 Agent 运行。
      }
    }
  }

  private saveArtifact(payload: unknown): void {
    const parsed = artifactPayloadSchema.parse(payload)
    this.persistence.saveArtifact(parsed.runId, parsed.artifact)
  }

  private describeArtifact(payload: unknown): AgentArtifactDescriptor {
    return this.persistence.describeArtifact(agentArtifactDescribeRequestSchema.parse(payload))
  }

  private readArtifact(payload: unknown): AgentArtifactPage {
    return this.persistence.readArtifact(agentArtifactReadRequestSchema.parse(payload))
  }

  private retrieveMemory(payload: unknown): AgentMemoryRetrievalResult {
    return this.memory.retrieveDetailed(agentMemoryRetrievalQuerySchema.parse(payload))
  }

  private requireRebindableRun(owner: WebContents, runId: string): AgentRunRecord {
    const record = this.runs.get(runId)
    const currentContext = getAssistantHostContext(owner.id)
    if (!record || record.ownerWebContentsId !== owner.id || !currentContext) {
      throw new Error('[run_not_owned] 运行不存在、宿主上下文缺失或无权访问')
    }
    record.rendererSessionId = currentContext.rendererSessionId
    return record
  }

  private requireOwnedRun(owner: WebContents, runId: string): AgentRunRecord {
    const record = this.runs.get(runId)
    const currentContext = getAssistantHostContext(owner.id)
    if (
      !record
      || record.ownerWebContentsId !== owner.id
      || !currentContext
      || currentContext.rendererSessionId !== record.rendererSessionId
    ) {
      throw new Error('[run_not_owned] 运行不存在、渲染会话已变化或无权访问')
    }
    return record
  }

  private resolveQueueRun(owner: WebContents, runId: string): AgentRunRecord {
    const live = this.runs.get(runId)
    if (live) return this.requireOwnedRun(owner, runId)
    const state = this.persistence.loadState(runId)
    const context = getAssistantHostContext(owner.id)
    if (!state || state.status !== 'waiting_external' || !context) {
      throw new Error('[run_not_owned] 排队消息不属于可恢复的外部等待')
    }
    return {
      ownerWebContentsId: owner.id,
      rendererSessionId: context.rendererSessionId,
      threadId: state.threadId,
      state,
      events: [],
    }
  }

  private sendEvent(record: AgentRunRecord, runId: string, event: AgentEvent): void {
    const target = webContents.fromId(record.ownerWebContentsId)
    const context = getAssistantHostContext(record.ownerWebContentsId)
    if (!target || target.isDestroyed() || context?.rendererSessionId !== record.rendererSessionId) return
    target.send('assistant:agent:event', agentRuntimeEventPayloadSchema.parse({ runId, event }))
  }
}

let runtimeService: AgentRuntimeService | null = null

export function getAgentRuntimeService(): AgentRuntimeService {
  runtimeService ??= new AgentRuntimeService()
  return runtimeService
}

export async function disposeAgentRuntimeService(): Promise<void> {
  if (!runtimeService) return
  await runtimeService.dispose()
  runtimeService = null
}
