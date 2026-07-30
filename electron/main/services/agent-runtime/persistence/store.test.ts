import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentRunState,
  type AgentEvent,
} from '../../../../../src/core/assistant/events'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentStartRunRequestSchema,
  type AgentStartRunRequest,
} from '../../../../../src/core/assistant/runtimeContracts'
import { runAgentSchemaMigrations } from './migrations'
import { AgentPersistenceStore } from './store'
import { AgentEventStream } from '../runner/event-stream'
import {
  agentWorkingSummarySchema,
  createAgentWorkingSummary,
} from '../../../../../src/core/assistant/workingContext'
import {
  AGENT_SAVE_POINT_VERSION,
  AGENT_TURN_SNAPSHOT_VERSION,
  AGENT_PROJECTION_VERSION,
  AGENT_COMPACTION_VERSION,
  type AgentTurnSnapshotDraft,
} from '../../../../../src/core/assistant/turn'

function request(): AgentStartRunRequest {
  const now = new Date().toISOString()
  return agentStartRunRequestSchema.parse({
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-1',
    goal: '诊断生成失败',
    userInstructions: '不应复制进运行请求存储',
    approvalMode: 'assistant_decides',
    profile: {
      id: 'profile-1',
      name: '测试配置',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: {
        timeoutMs: 5_000,
        maxRetries: 0,
        maxOutputTokens: 1_000,
        contextWindowBudget: 8_000,
      },
      verifications: [],
      createdAt: now,
      updatedAt: now,
    },
    models: [{
      providerId: 'provider',
      modelId: 'model',
      displayName: '测试模型',
      adapter: 'openai-compatible',
      capabilities: {
        text: true,
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: true,
        parallelTools: false,
        jsonOutput: true,
        structuredOutputMode: 'json',
        reasoning: false,
        sampling: true,
        contextWindow: 32_000,
        maxOutputTokens: 4_000,
        usage: true,
      },
      enabled: true,
    }],
  })
}

function state(status: AgentRunState['status'] = 'running'): AgentRunState {
  const now = new Date().toISOString()
  return agentRunStateSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    runId: 'run-1',
    threadId: 'thread-1',
    status,
    sequence: 0,
    turn: 0,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    startedAt: now,
    updatedAt: now,
    finalText: null,
    error: null,
    budget: {
      maxTurns: 12,
      maxToolCalls: 24,
      maxDurationMs: 600_000,
      maxInputTokens: 200_000,
      maxOutputTokens: 20_000,
      maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 3,
      maxNoProgressTurns: 3,
    },
    usage: {
      turns: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      knownCostUsd: null,
      consecutiveFailures: 0,
      noProgressTurns: 0,
      elapsedMs: 0,
    },
    lastScopeRevisions: null,
  })
}

function eventForSequence(sequence: number): AgentEvent {
  return agentEventSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 6, 30) + sequence).toISOString(),
    runId: 'run-1',
    type: 'RunStarted',
    threadId: 'thread-1',
  })
}

function turnSnapshot(): AgentTurnSnapshotDraft {
  return {
    version: AGENT_TURN_SNAPSHOT_VERSION,
    runId: 'run-1', threadId: 'thread-1', turn: 1,
    projectionVersion: AGENT_PROJECTION_VERSION,
    compactionVersion: AGENT_COMPACTION_VERSION,
    models: ['primary', 'router', 'summarizer'].map((role) => ({
      role: role as 'primary' | 'router' | 'summarizer',
      providerId: 'provider', modelId: 'model', apiProtocol: 'openai-compatible',
    })),
    tools: [{ name: 'tool', version: 1, schemaDigest: 'a'.repeat(64) }],
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    artifactRefs: [],
    requestOptions: {
      contextWindow: 32_000, maxOutputTokens: 1_000, timeoutMs: 5_000,
      approvalMode: 'assistant_decides',
    },
  }
}

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('AgentPersistenceStore', () => {
  let database: Database.Database
  let store: AgentPersistenceStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    store = new AgentPersistenceStore(database)
  })

  afterEach(() => {
    database.close()
  })

  it('保存并恢复运行、事件、请求与大结果引用', () => {
    const initial = state()
    store.createRun('run-1', request(), initial)
    const event = agentEventSchema.parse({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: 'event-1',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      runId: 'run-1',
      type: 'RunStarted',
      threadId: 'thread-1',
    })
    store.appendEvent(event)
    store.saveArtifact('run-1', {
      artifactRef: 'artifact:1',
      source: 'query:call-1',
      dataClasses: ['C1'],
      createdAt: new Date().toISOString(),
      originalBytes: 12,
      payload: { ok: true },
    })

    expect(store.loadState('run-1')).toMatchObject({ runId: 'run-1', status: 'running' })
    expect(store.loadEvents('run-1')).toEqual([event])
    expect(store.loadArtifact('artifact:1')).toMatchObject({ payload: { ok: true } })
    expect(store.loadRequest('run-1')).not.toHaveProperty('userInstructions')
    expect(store.listRuns('thread-1')).toMatchObject([{
      runId: 'run-1',
      recoveryStatus: 'none',
      canRetry: false,
    }])
  })

  it('保存点与 session head/checkpoint 幂等对齐并在终局 settled', () => {
    const running = state()
    running.turn = 1
    store.createRun('run-1', request(), running)
    const input = {
      version: AGENT_SAVE_POINT_VERSION,
      stage: 'before_model' as const,
      snapshot: turnSnapshot(),
      state: running,
      idempotencyKey: 'before-model:run-1:1',
    }
    const first = store.appendSavePoint(input)
    const duplicate = store.appendSavePoint(input)
    expect(duplicate).toEqual(first)
    expect(first.snapshot.sessionHeadSequence).toBe(1)
    expect(first.stateSequence).toBe(running.sequence)
    expect(store.countSavePoints('run-1')).toBe(1)

    const completed = state('completed')
    completed.turn = 1
    completed.finalText = '完成'
    store.saveState(completed)
    store.appendTerminalMessage(completed)
    store.appendSettledSavePoint(completed)
    expect(store.loadLatestSavePoint('run-1')).toMatchObject({
      stage: 'settled',
      snapshot: { sessionHeadSequence: 2 },
    })
    expect(store.countSavePoints('run-1')).toBe(2)
  })

  it('按 thread sequence 幂等追加会话消息并投影多轮历史', () => {
    const first = state('completed')
    first.finalText = '第一轮回答'
    store.createRun('run-1', request(), first)
    store.appendTerminalMessage(first)
    store.appendTerminalMessage(first)

    const secondRequest = agentStartRunRequestSchema.parse({
      ...request(),
      goal: '继续，沿用第一轮约束',
    })
    const second = agentRunStateSchema.parse({
      ...state(),
      runId: 'run-2',
    })
    store.createRun('run-2', secondRequest, second)

    expect(store.loadTranscript('thread-1')).toMatchObject({
      headSequence: 3,
      coveredThroughSequence: 3,
      hasMore: false,
    })
    expect(store.loadTranscript('thread-1').entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      runId: entry.runId,
    }))).toEqual([
      { sequence: 1, kind: 'user_message', runId: 'run-1' },
      { sequence: 2, kind: 'assistant_message', runId: 'run-1' },
      { sequence: 3, kind: 'user_message', runId: 'run-2' },
    ])
    expect(store.projectConversation('thread-1', 'run-2')).toEqual({
      messages: [
        { role: 'user', content: '诊断生成失败' },
        { role: 'assistant', content: '第一轮回答' },
      ],
      sourceSequences: [1, 2],
    })
    expect(store.listThreads()).toMatchObject([{
      threadId: 'thread-1',
      headSequence: 3,
      lastRunId: 'run-2',
      lastRunGoal: '继续，沿用第一轮约束',
      lastMessagePreview: '继续，沿用第一轮约束',
    }])
  })

  it('会话分页无重复且新 thread 不会混入旧历史', () => {
    store.createRun('run-1', request(), state())
    const otherRequest = agentStartRunRequestSchema.parse({
      ...request(),
      threadId: 'thread-2',
      goal: '独立会话',
    })
    const otherState = agentRunStateSchema.parse({
      ...state(),
      runId: 'run-2',
      threadId: 'thread-2',
    })
    store.createRun('run-2', otherRequest, otherState)

    const firstPage = store.loadTranscript('thread-1', 0, 1)
    const nextPage = store.loadTranscript('thread-1', firstPage.coveredThroughSequence, 1)
    expect(firstPage.entries.map((entry) => entry.entryId)).not.toEqual(
      nextPage.entries.map((entry) => entry.entryId)
    )
    expect(store.projectConversation('thread-2')).toEqual({
      messages: [{ role: 'user', content: '独立会话' }],
      sourceSequences: [1],
    })
  })

  it('旧数据库消息在追加 migration 后以稳定顺序兼容读取', () => {
    database.exec(`
      DROP TABLE agent_session_entries;
      DELETE FROM app_schema_migrations WHERE version = 6;
    `)
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES ('legacy-thread', '旧对话', 1000, 1001, NULL)
    `).run()
    const insertLegacy = database.prepare(`
      INSERT INTO agent_messages(message_id, thread_id, run_id, role, content, created_at)
      VALUES (?, 'legacy-thread', NULL, ?, ?, ?)
    `)
    insertLegacy.run('message-b', 'assistant', '旧回答', 1001)
    insertLegacy.run('message-a', 'user', '旧问题', 1000)

    runAgentSchemaMigrations(database)
    const migrated = new AgentPersistenceStore(database)
    const entries = migrated.loadTranscript('legacy-thread').entries

    expect(entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      payload: entry.payload,
    }))).toEqual([
      { sequence: 1, kind: 'user_message', payload: { content: '旧问题', legacy: true } },
      { sequence: 2, kind: 'assistant_message', payload: { content: '旧回答', legacy: true } },
    ])
  })

  it('尾部恢复返回最新两千条，并支持从已确认 sequence 增量补拉', () => {
    store.createRun('run-1', request(), state())
    database.transaction(() => {
      for (let sequence = 1; sequence <= 2_050; sequence += 1) {
        store.appendEvent(eventForSequence(sequence))
      }
    })()

    const tail = store.loadEvents('run-1')
    expect(tail).toHaveLength(2_000)
    expect(tail[0]?.sequence).toBe(51)
    expect(tail.at(-1)?.sequence).toBe(2_050)
    expect(tail.every((event, index) => index === 0 || event.sequence > tail[index - 1].sequence)).toBe(true)

    const page = store.loadEventsAfter('run-1', 1_998, 10)
    expect(page).toMatchObject({ oldestSequence: 1, latestSequence: 2_050 })
    expect(page.events.map((event) => event.sequence)).toEqual([
      1_999, 2_000, 2_001, 2_002, 2_003, 2_004, 2_005, 2_006, 2_007, 2_008,
    ])
  })

  it('一万个原始模型增量合并后只写入有界数量的 SQLite 事件', () => {
    store.createRun('run-1', request(), state())
    const stream = new AgentEventStream('run-1')
    stream.subscribe((event) => store.appendEvent(event))

    for (let index = 0; index < 10_000; index += 1) {
      stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: '流' })
    }
    stream.emit({
      type: 'ModelCompleted',
      stepId: 'step-1',
      finishReason: 'stop',
      toolCallCount: 0,
      usage: {
        inputTokens: 1,
        inputNoCacheTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10_000,
        textTokens: 10_000,
        reasoningTokens: 0,
        totalTokens: 10_001,
      },
    })

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM agent_events WHERE run_id = 'run-1'
    `).get() as { count: number }
    const events = store.loadEvents('run-1')
    expect(count.count).toBeLessThan(10)
    expect(events.filter((event) => event.type === 'ModelDelta').map((event) => event.text).join(''))
      .toBe('流'.repeat(10_000))
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1)
    )
  })

  it('应用重启后把未完成运行转为需要人工重试，不自动重放', () => {
    store.createRun('run-1', request(), state('waiting_tool'))

    expect(store.markInterruptedRuns()).toBe(1)
    expect(store.loadState('run-1')).toMatchObject({
      status: 'failed',
      error: { code: 'RECOVERY_REQUIRED', recovery: 'user_action' },
    })
    expect(store.listRuns('thread-1')[0]).toMatchObject({
      recoveryStatus: 'recovery_required',
      canRetry: true,
    })
    const events = store.loadEvents('run-1')
    expect(events[events.length - 1]).toMatchObject({ type: 'RunFailed' })
  })

  it('混合版本 checkpoint 仍以受校验 state_json 查看旧运行', () => {
    store.createRun('run-1', request(), state('completed'))
    database.prepare(`
      UPDATE agent_runs SET checkpoint_version = 'agent-checkpoint/v0', checkpoint_json = '{}'
      WHERE run_id = 'run-1'
    `).run()
    expect(new AgentPersistenceStore(database).loadState('run-1')).toMatchObject({
      runId: 'run-1', status: 'completed',
    })
  })

  it('v6 数据库增量迁移保存 waiting_external 运行且重启不误判为中断', () => {
    store.createRun('run-1', request(), state('waiting_external'))
    database.exec(`
      DROP TABLE agent_external_waits;
      DROP TABLE agent_generation_status_events;
      DROP TABLE agent_save_points;
      DELETE FROM app_schema_migrations WHERE version IN (7, 8);
    `)
    runAgentSchemaMigrations(database)
    const migrated = new AgentPersistenceStore(database)
    expect(migrated.markInterruptedRuns()).toBe(0)
    expect(migrated.loadState('run-1')).toMatchObject({ status: 'waiting_external' })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM app_schema_migrations WHERE version IN (7, 8)
    `).get()).toEqual({ count: 2 })
  })

  it('未来检查点版本不会导致崩溃，而是进入安全恢复状态', () => {
    store.createRun('run-1', request(), state('paused'))
    database.prepare(`
      UPDATE agent_runs SET checkpoint_version = 'agent-checkpoint/v999' WHERE run_id = 'run-1'
    `).run()

    expect(store.loadState('run-1')).toMatchObject({
      status: 'failed',
      error: { code: 'CHECKPOINT_VERSION_MISMATCH' },
    })
    expect(store.listRuns('thread-1')[0].recoveryStatus).toBe('recovery_required')
  })

  it('中断检查点保留结构化目标并标记未知写入需要先验证', () => {
    const interrupted = state('waiting_tool')
    interrupted.workingSummary = agentWorkingSummarySchema.parse({
      ...createAgentWorkingSummary('创建一个生成任务'),
      activeStep: {
        stepId: 'call-write',
        title: '创建生成任务',
        status: 'active',
        toolName: 'create_visible_generation_task',
        toolCategory: 'generation',
        readOnly: false,
        idempotent: true,
        summary: '',
        evidence: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    })
    store.createRun('run-1', request(), interrupted)

    store.markInterruptedRuns()

    expect(store.loadState('run-1')).toMatchObject({
      workingSummary: {
        goal: '创建一个生成任务',
        activeStep: null,
        recovery: {
          mode: 'verify_before_write',
          toolName: 'create_visible_generation_task',
        },
      },
    })
  })
})
