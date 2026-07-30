import { randomUUID } from 'node:crypto'
import { webContents, type WebContents } from 'electron'
import { z } from 'zod'

import {
  agentRunSnapshotSchema,
  agentRuntimeEventPayloadSchema,
  type AgentRunEventsPage,
  type AgentRunSnapshot,
  type AgentStartRunRequest,
  type AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentRunSummary } from '../../../../src/core/assistant/persistence'
import {
  agentDataClassSchema,
} from '../../../../src/core/assistant/toolContracts'
import type { AgentEvent, AgentRunState } from '../../../../src/core/assistant/events'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import {
  agentMemoryRetrievalQuerySchema,
  type AgentMemoryRetrievalResult,
} from '../../../../src/core/assistant/memory'
import type {
  FrontendToolOperation,
  HostCommandResult,
  HostContextSnapshot,
} from '../../../../src/core/assistant/hostContracts'
import {
  cancelAssistantFrontendTool,
  createFrontendToolRequest,
  getAssistantHostContext,
  requestAssistantFrontendTool,
} from '../assistant/frontend-tool-bridge'
import { getDb } from '../db'
import { getLlmProviderApiKey } from '../keystore'
import { getAgentMemoryStore } from '../assistant/memory'
import { AgentRuntimeManager } from '../agent-runtime-manager/manager'
import {
  createMainLogger,
  getAgentTraceCaptureMode,
  getAgentTraceStore,
} from '../logging'
import { createInitialAgentRunState } from './runner/initial-state'
import { AgentPersistenceStore } from './persistence/store'
import { buildAgentRunEventsPage } from './persistence/event-store'
import { AgentPermissionAuditStore } from './persistence/permission-audit-store'
import type { AgentPermissionAuditRecord } from '../../../../src/core/assistant/permissionAudit'
import { createBuiltinAgentToolRegistry } from './tools/builtin'
import { prepareWorkingSummaryForRetry } from './runner/working-summary'
const logger = createMainLogger('main.agent_runtime')

interface AgentRunRecord {
  ownerWebContentsId: number
  rendererSessionId: string
  threadId: string
  state: AgentRunState
  events: AgentEvent[]
}

export type AgentRunEventListener = (event: AgentEvent) => void

const artifactPayloadSchema = z.object({
  runId: z.string().min(1),
  artifact: z.object({
    artifactRef: z.string().min(1),
    source: z.string().min(1),
    dataClasses: z.array(agentDataClassSchema).max(4),
    createdAt: z.string().datetime(),
    originalBytes: z.number().int().nonnegative(),
    payload: z.unknown(),
  }).strict(),
}).strict()

const toolExecutionPayloadSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
}).strict()

export class AgentRuntimeService {
  private readonly runs = new Map<string, AgentRunRecord>()
  private readonly activeByThread = new Map<string, string>()
  private readonly eventListeners = new Map<string, Set<AgentRunEventListener>>()
  private readonly persistence = new AgentPersistenceStore(getDb())
  private readonly permissionAudit = new AgentPermissionAuditStore(getDb())
  private readonly agentTraceStore = getAgentTraceStore()
  private readonly memory = getAgentMemoryStore()
  private readonly registry = createBuiltinAgentToolRegistry((operation, context) => (
    this.invokeFrontend(operation, context)
  ))
  private readonly manager = new AgentRuntimeManager({
    getModelApiKey: getLlmProviderApiKey,
    executeTool: (payload, signal) => this.executeToolInMain(payload, signal),
    saveArtifact: (payload) => this.saveArtifact(payload),
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
  })

  constructor() {
    this.persistence.markInterruptedRuns()
  }

  async startRun(owner: WebContents, request: AgentStartRunRequest): Promise<AgentStartRunResult> {
    return await this.startRunWithParent(owner, request, null, undefined)
  }

  private async startRunWithParent(
    owner: WebContents,
    request: AgentStartRunRequest,
    parentRunId: string | null,
    recoveryContext: AgentWorkingSummary | undefined
  ): Promise<AgentStartRunResult> {
    const hostContext = getAssistantHostContext(owner.id)
    if (!hostContext?.uiReady) throw new Error('[host_not_ready] 宿主界面尚未就绪')
    const activeRunId = this.activeByThread.get(request.threadId)
    if (activeRunId) {
      const active = this.runs.get(activeRunId)?.state
      if (active && !['completed', 'failed', 'cancelled'].includes(active.status)) {
        throw new Error(`[thread_busy] thread ${request.threadId} 已有活动运行 ${activeRunId}`)
      }
    }

    const preparedRecoveryContext = recoveryContext
      ? prepareWorkingSummaryForRetry(
          recoveryContext,
          hostContext.scopeRevisions,
          recoveryContext.artifactRefs.filter((ref) => Boolean(this.persistence.loadArtifact(ref)))
        )
      : undefined
    const runId = randomUUID()
    const initialState = createInitialAgentRunState(runId, request, preparedRecoveryContext)
    this.runs.set(runId, {
      ownerWebContentsId: owner.id,
      rendererSessionId: hostContext.rendererSessionId,
      threadId: request.threadId,
      state: initialState,
      events: [],
    })
    this.activeByThread.set(request.threadId, runId)
    this.persistence.createRun(runId, request, initialState, parentRunId)
    try {
      const memoryContext = this.memory.retrieve(
        request.goal,
        hostContext.workspace.id,
        hostContext.project.id
      )
      const state = await this.manager.startRun(
        runId,
        request,
        hostContext,
        memoryContext,
        preparedRecoveryContext
      )
      this.updateState(runId, state)
      return { runId, state }
    } catch (error) {
      this.activeByThread.delete(request.threadId)
      const failed = this.persistence.markRunRecoveryRequired(
        runId,
        'Agent 独立运行进程未能确认启动；为避免重复副作用，需要由用户确认后重试'
      )
      if (failed) this.updateState(runId, failed)
      throw error
    }
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
    if (!['completed', 'failed', 'cancelled'].includes(previous.status)) {
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
    this.updateState(runId, state)
    this.persistence.saveState(state)
    this.persistence.appendTerminalMessage(state)
    if (record && this.activeByThread.get(record.threadId) === runId) {
      this.activeByThread.delete(record.threadId)
    }
    this.eventListeners.delete(runId)
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

  private async executeToolInMain(payload: unknown, signal: AbortSignal): Promise<unknown> {
    const parsed = toolExecutionPayloadSchema.parse(payload)
    const definition = this.registry.get(parsed.toolName)
    if (!definition) throw new Error(`[unknown_tool] 未注册工具：${parsed.toolName}`)
    const input = definition.inputSchema.parse(parsed.input)
    const hostContext = this.getRunHostContext(parsed.runId)
    const output = await definition.execute(input, {
      runId: parsed.runId,
      threadId: parsed.threadId,
      toolCallId: parsed.toolCallId,
      signal,
      hostContext,
    })
    return {
      output: definition.outputSchema.parse(output),
      hostContext: this.getRunHostContext(parsed.runId),
    }
  }

  private saveArtifact(payload: unknown): void {
    const parsed = artifactPayloadSchema.parse(payload)
    this.persistence.saveArtifact(parsed.runId, parsed.artifact)
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

  private getRunHostContext(runId: string): HostContextSnapshot | null {
    const record = this.runs.get(runId)
    if (!record) return null
    const context = getAssistantHostContext(record.ownerWebContentsId)
    return context?.rendererSessionId === record.rendererSessionId ? context : null
  }

  private async invokeFrontend(
    operation: FrontendToolOperation,
    context: { runId: string; toolCallId: string; signal: AbortSignal }
  ): Promise<HostCommandResult> {
    const record = this.runs.get(context.runId)
    if (!record) throw new Error('[run_not_found] Agent run not found')
    const sender = webContents.fromId(record.ownerWebContentsId)
    if (!sender || sender.isDestroyed()) throw new Error('[renderer_gone] Renderer is unavailable')
    const callId = randomUUID()
    const onAbort = (): void => { cancelAssistantFrontendTool(callId, 'Agent 工具调用已取消') }
    context.signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await requestAssistantFrontendTool(sender, createFrontendToolRequest({
        runId: context.runId,
        toolCallId: context.toolCallId,
        callId,
        idempotencyKey: `${context.runId}:${context.toolCallId}`,
        deadline: Date.now() + 60_000,
        operation,
      }))
    } finally {
      context.signal.removeEventListener('abort', onAbort)
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
