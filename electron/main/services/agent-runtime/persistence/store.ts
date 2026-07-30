import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  AGENT_CHECKPOINT_VERSION,
  agentRunSummarySchema,
  storedAgentRunRequestSchema,
  type AgentRunSummary,
  type StoredAgentRunRequest,
} from '../../../../../src/core/assistant/persistence'
import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentEvent,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import type { AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentContextArtifact } from '../context/types'
import { createMainLogger } from '../../logging'
import { assessInterruptedWorkingSummary } from '../runner/working-summary'
import { AgentEventStore, type AgentStoredEventPage } from './event-store'
import { AgentArtifactPersistenceStore } from './artifact-store'
import { AgentSessionStore, type AgentConversationProjection } from './session-store'
import type { AgentThreadSummary, AgentTranscriptPage } from '../../../../../src/core/assistant/session'
import type { AgentSessionCompactionAppend } from '../../../../../src/core/assistant/session'
import type { AgentSessionInternalAppend } from '../../../../../src/core/assistant/session'
import type {
  AgentEnqueueMessageRequest,
  AgentEnqueueMessageResult,
  AgentCancelQueuedMessageRequest,
  AgentSessionEntry,
} from '../../../../../src/core/assistant/session'
import {
  agentSavePointAppendSchema,
  type AgentSavePoint,
  type AgentSavePointAppend,
} from '../../../../../src/core/assistant/turn'
import type {
  AgentArtifactDescribeRequest,
  AgentArtifactDescriptor,
  AgentArtifactPage,
  AgentArtifactReadRequest,
} from '../../../../../src/core/assistant/artifacts'
import { AgentSavePointStore } from './save-point-store'
import { AgentExternalWaitStore } from './external-wait-store'
import { AgentThreadTitleStore } from './thread-title-store'

const logger = createMainLogger('main.agent_persistence')
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'waiting_external'])
const FALLBACK_THREAD_TITLE_MAX_CHARS = 24

interface RunRow {
  run_id: string
  thread_id: string
  goal: string
  request_json: string
  state_json: string
  status: AgentRunState['status']
  checkpoint_version: string
  checkpoint_json: string
  recovery_status: 'none' | 'recovery_required' | 'retried'
  parent_run_id: string | null
  created_at: number
  updated_at: number
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function storedRequest(request: AgentStartRunRequest): StoredAgentRunRequest {
  const { userInstructions: _userInstructions, ...rest } = request
  return storedAgentRunRequestSchema.parse(rest)
}

function checkpointJson(state: AgentRunState): string {
  return JSON.stringify({
    version: AGENT_CHECKPOINT_VERSION,
    savedAt: new Date().toISOString(),
    state,
  })
}

function fallbackThreadTitle(goal: string): string {
  const normalized = goal.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  const characters = Array.from(normalized)
  if (characters.length <= FALLBACK_THREAD_TITLE_MAX_CHARS) return normalized
  return `${characters.slice(0, FALLBACK_THREAD_TITLE_MAX_CHARS).join('')}…`
}

export class AgentPersistenceStore {
  private readonly eventStore: AgentEventStore
  private readonly artifactStore: AgentArtifactPersistenceStore
  private readonly sessionStore: AgentSessionStore
  private readonly savePointStore: AgentSavePointStore
  readonly externalWait: AgentExternalWaitStore
  readonly threadTitles: AgentThreadTitleStore

  constructor(private readonly database: Database.Database) {
    this.eventStore = new AgentEventStore(database)
    this.artifactStore = new AgentArtifactPersistenceStore(database)
    this.sessionStore = new AgentSessionStore(database)
    this.savePointStore = new AgentSavePointStore(database)
    this.externalWait = new AgentExternalWaitStore(database)
    this.threadTitles = new AgentThreadTitleStore(database)
  }

  createRun(
    runId: string,
    request: AgentStartRunRequest,
    state: AgentRunState,
    parentRunId: string | null = null
  ): void {
    const now = Date.now()
    const requestForStorage = storedRequest(request)
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          last_run_id = excluded.last_run_id
      `).run(request.threadId, fallbackThreadTitle(request.goal), now, now, runId)
      this.database.prepare(`
        INSERT INTO agent_runs(
          run_id, thread_id, goal, request_json, state_json, status,
          checkpoint_version, checkpoint_json, recovery_status,
          parent_run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)
      `).run(
        runId,
        request.threadId,
        request.goal,
        JSON.stringify(requestForStorage),
        JSON.stringify(state),
        state.status,
        AGENT_CHECKPOINT_VERSION,
        checkpointJson(state),
        parentRunId,
        now,
        now
      )
      this.database.prepare(`
        INSERT INTO agent_messages(message_id, thread_id, run_id, role, content, created_at)
        VALUES (?, ?, ?, 'user', ?, ?)
        ON CONFLICT(message_id) DO NOTHING
      `).run(`run:${runId}:user`, request.threadId, runId, request.goal, now)
      this.sessionStore.appendMessage({
        threadId: request.threadId,
        runId,
        role: 'user',
        content: request.goal,
        idempotencyKey: `run:${runId}:user`,
        createdAt: now,
      })
    })()
    logger.info('Agent 运行持久化已创建', {
      event: 'agent_persistence.run.created',
      requestId: runId,
      context: { threadId: request.threadId, parentRunId },
    })
  }

  saveState(state: AgentRunState): void {
    this.database.prepare(`
      UPDATE agent_runs
      SET state_json = ?, status = ?, checkpoint_version = ?,
          checkpoint_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(
      JSON.stringify(state),
      state.status,
      AGENT_CHECKPOINT_VERSION,
      checkpointJson(state),
      Date.now(),
      state.runId
    )
  }

  appendEvent(event: AgentEvent): void {
    this.eventStore.append(event)
  }

  appendTerminalMessage(state: AgentRunState): void {
    const content = state.finalText
      ?? state.error?.message
      ?? (state.status === 'cancelled' ? '任务已取消。' : null)
    if (!content) return
    const now = Date.now()
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO agent_messages(message_id, thread_id, run_id, role, content, created_at)
        VALUES (?, ?, ?, 'assistant', ?, ?)
        ON CONFLICT(message_id) DO NOTHING
      `).run(`run:${state.runId}:assistant`, state.threadId, state.runId, content, now)
      this.sessionStore.appendMessage({
        threadId: state.threadId,
        runId: state.runId,
        role: 'assistant',
        content,
        idempotencyKey: `run:${state.runId}:assistant`,
        createdAt: now,
        contextVisible: false,
      })
    })()
  }

  appendAssistantFact(
    threadId: string,
    runId: string,
    content: string,
    idempotencyKey: string
  ): AgentSessionEntry {
    return this.database.transaction(() => this.sessionStore.appendMessage({
      threadId,
      runId,
      role: 'assistant',
      content,
      idempotencyKey,
    }))()
  }

  listThreads(limit = 30): AgentThreadSummary[] {
    return this.sessionStore.listThreads(limit)
  }

  loadTranscript(threadId: string, afterSequence = 0, limit = 100): AgentTranscriptPage {
    return this.sessionStore.loadTranscript(threadId, afterSequence, limit)
  }

  projectConversation(threadId: string, excludeRunId?: string): AgentConversationProjection {
    return this.sessionStore.projectConversation(threadId, excludeRunId)
  }

  appendSessionCompaction(input: AgentSessionCompactionAppend): AgentSessionEntry {
    return this.database.transaction(() => (
      this.sessionStore.appendCompaction({
        ...input,
        idempotencyKey: `compaction:${input.runId}:${input.payload.coveredThroughSequence}`,
      })
    ))()
  }

  appendSessionInternal(input: AgentSessionInternalAppend): AgentSessionEntry {
    return this.database.transaction(() => this.sessionStore.appendInternalMessage(input))()
  }

  getSessionHead(threadId: string): number {
    return this.sessionStore.getHead(threadId)
  }

  appendSavePoint(raw: AgentSavePointAppend): AgentSavePoint {
    const input = agentSavePointAppendSchema.parse(raw)
    if (input.snapshot.runId !== input.state.runId || input.snapshot.threadId !== input.state.threadId) {
      throw new Error('[SAVE_POINT_RUN_MISMATCH] 保存点与运行不匹配')
    }
    return this.database.transaction(() => {
      this.saveState(input.state)
      return this.savePointStore.append(input, this.sessionStore.getHead(input.state.threadId))
    })()
  }

  appendSettledSavePoint(state: AgentRunState): AgentSavePoint | null {
    return this.savePointStore.appendSettled(state, this.sessionStore.getHead(state.threadId))
  }

  loadLatestSavePoint(runId: string): AgentSavePoint | null {
    return this.savePointStore.latest(runId)
  }

  countSavePoints(runId: string): number {
    return this.savePointStore.count(runId)
  }

  enqueueMessage(input: AgentEnqueueMessageRequest): AgentEnqueueMessageResult {
    return this.database.transaction(() => this.sessionStore.enqueueMessage({
      threadId: input.threadId,
      runId: input.runId,
      clientMessageId: input.clientMessageId,
      content: input.content,
      mode: input.mode,
      waitId: input.waitId,
    }))()
  }

  consumeCurrentTaskMessages(runId: string): AgentSessionEntry[] {
    return this.database.transaction(() => (
      this.sessionStore.consumeQueuedMessages(runId, 'current_task')
    ))()
  }

  consumeAfterTaskMessages(runId: string): AgentSessionEntry[] {
    return this.database.transaction(() => (
      this.sessionStore.consumeQueuedMessages(runId, 'after_task')
    ))()
  }

  listCurrentTaskMessages(runId: string): AgentSessionEntry[] {
    return this.sessionStore.listQueuedMessages(runId, 'current_task')
  }

  listAfterTaskMessages(runId: string): AgentSessionEntry[] {
    return this.sessionStore.listQueuedMessages(runId, 'after_task')
  }

  findAcceptedAfterTaskRun(threadId: string): string | null {
    return this.sessionStore.findAcceptedAfterTaskRun(threadId)
  }

  retargetAfterTaskMessages(sourceRunId: string, targetRunId: string): number {
    return this.sessionStore.retargetAfterTaskMessages(sourceRunId, targetRunId)
  }

  updateQueuedMessageStatus(
    entryId: string,
    expected: 'accepted' | 'consumed' | 'cancelled' | 'failed',
    status: 'accepted' | 'consumed' | 'cancelled' | 'failed',
    reason?: string,
    consumedByRunId?: string
  ): AgentSessionEntry | null {
    return this.sessionStore.updateQueuedMessageStatus(
      entryId, expected, status, reason, consumedByRunId
    )
  }

  cancelQueuedMessage(input: AgentCancelQueuedMessageRequest): AgentSessionEntry {
    return this.database.transaction(() => this.sessionStore.cancelQueuedMessage(
      input.threadId,
      input.entryId
    ))()
  }

  cancelCurrentTaskMessages(runId: string, reason: string): number {
    return this.sessionStore.cancelQueuedMessages(runId, reason)
  }

  saveArtifact(runId: string, artifact: AgentContextArtifact): void {
    this.database.prepare(`
      INSERT OR REPLACE INTO agent_artifacts(
        artifact_ref, run_id, source, data_classes_json,
        payload_json, original_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.artifactRef,
      runId,
      artifact.source,
      JSON.stringify(artifact.dataClasses),
      JSON.stringify(artifact.payload),
      artifact.originalBytes,
      Date.parse(artifact.createdAt)
    )
  }

  loadArtifact(artifactRef: string): AgentContextArtifact | null {
    return this.artifactStore.load(artifactRef)
  }

  describeArtifact(request: AgentArtifactDescribeRequest): AgentArtifactDescriptor {
    return this.artifactStore.describe(request)
  }

  readArtifact(request: AgentArtifactReadRequest): AgentArtifactPage {
    return this.artifactStore.read(request)
  }

  loadState(runId: string): AgentRunState | null {
    const row = this.getRunRow(runId)
    if (!row) return null
    if (row.checkpoint_version !== AGENT_CHECKPOINT_VERSION && !terminalStatuses.has(row.status)) {
      return this.moveToRecoveryRequired(
        row,
        'CHECKPOINT_VERSION_MISMATCH',
        '保存的任务检查点版本与当前应用不兼容；为避免错误重放，需要由用户确认后重新运行'
      )
    }
    return agentRunStateSchema.parse(parseJson(row.state_json))
  }

  loadRequest(runId: string): StoredAgentRunRequest | null {
    const row = this.getRunRow(runId)
    return row ? storedAgentRunRequestSchema.parse(parseJson(row.request_json)) : null
  }

  loadEvents(runId: string): AgentEvent[] {
    return this.eventStore.loadTail(runId)
  }

  loadEventsAfter(runId: string, afterSequence: number, limit: number): AgentStoredEventPage {
    return this.eventStore.loadAfter(runId, afterSequence, limit)
  }

  listRuns(threadId?: string, limit = 30): AgentRunSummary[] {
    const safeLimit = Math.max(1, Math.min(100, limit))
    const rows = (threadId
      ? this.database.prepare(`
          SELECT * FROM agent_runs WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?
        `).all(threadId, safeLimit)
      : this.database.prepare(`
          SELECT * FROM agent_runs ORDER BY updated_at DESC LIMIT ?
        `).all(safeLimit)) as RunRow[]
    return rows.map((row) => agentRunSummarySchema.parse({
      runId: row.run_id,
      threadId: row.thread_id,
      goal: row.goal,
      status: row.status,
      recoveryStatus: row.recovery_status,
      parentRunId: row.parent_run_id,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      canRetry: row.recovery_status === 'recovery_required' || terminalStatuses.has(row.status),
    }))
  }

  markRetried(runId: string): void {
    this.database.prepare(`
      UPDATE agent_runs SET recovery_status = 'retried', updated_at = ? WHERE run_id = ?
    `).run(Date.now(), runId)
  }

  markInterruptedRuns(): number {
    const rows = this.database.prepare(`
      SELECT * FROM agent_runs
      WHERE status IN ('initializing', 'running', 'waiting_tool', 'waiting_approval', 'waiting_user', 'paused')
    `).all() as RunRow[]
    for (const row of rows) {
      const mismatch = row.checkpoint_version !== AGENT_CHECKPOINT_VERSION
      this.moveToRecoveryRequired(
        row,
        mismatch ? 'CHECKPOINT_VERSION_MISMATCH' : 'RECOVERY_REQUIRED',
        mismatch
          ? '保存的任务检查点版本与当前应用不兼容；为避免错误重放，需要由用户确认后重新运行'
          : '应用在任务完成前退出；为避免重复执行未知副作用，需要由用户确认后重试'
      )
      this.sessionStore.cancelQueuedMessages(
        row.run_id,
        '应用退出前未到达消费点，当前任务补充已安全取消'
      )
      logger.warn('检测到未完成 Agent 运行，已转为安全恢复状态', {
        event: 'agent_persistence.run.recovery_required',
        requestId: row.run_id,
        context: { previousStatus: row.status },
      })
    }
    return rows.length
  }

  markRunRecoveryRequired(runId: string, message: string): AgentRunState | null {
    const row = this.getRunRow(runId)
    if (!row) return null
    return this.moveToRecoveryRequired(row, 'RECOVERY_REQUIRED', message)
  }

  private getRunRow(runId: string): RunRow | null {
    return (this.database.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId) as RunRow | undefined) ?? null
  }

  private moveToRecoveryRequired(
    row: RunRow,
    code: 'RECOVERY_REQUIRED' | 'CHECKPOINT_VERSION_MISMATCH',
    message: string
  ): AgentRunState {
    if (row.recovery_status === 'recovery_required' && row.status === 'failed') {
      return agentRunStateSchema.parse(parseJson(row.state_json))
    }
    const previous = agentRunStateSchema.parse(parseJson(row.state_json))
    const now = new Date().toISOString()
    const sequence = previous.sequence + 1
    const error = {
      code,
      message,
      retryable: true,
      recovery: 'user_action' as const,
    }
    const state = agentRunStateSchema.parse({
      ...previous,
      status: 'failed',
      sequence,
      currentStepId: null,
      currentToolCallId: null,
      waitingApprovalId: null,
      updatedAt: now,
      error,
      workingSummary: previous.workingSummary
        ? assessInterruptedWorkingSummary(previous.workingSummary)
        : undefined,
    })
    const event = agentEventSchema.parse({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: randomUUID(),
      sequence,
      occurredAt: now,
      runId: row.run_id,
      type: 'RunFailed',
      error,
      usage: previous.usage,
    })
    this.database.transaction(() => {
      this.appendEvent(event)
      this.database.prepare(`
        UPDATE agent_runs
        SET state_json = ?, status = 'failed', checkpoint_version = ?,
            checkpoint_json = ?, recovery_status = 'recovery_required', updated_at = ?
        WHERE run_id = ?
      `).run(
        JSON.stringify(state),
        AGENT_CHECKPOINT_VERSION,
        checkpointJson(state),
        Date.now(),
        row.run_id
      )
    })()
    return state
  }
}
