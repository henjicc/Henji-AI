import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentStartRunRequestSchema,
  type AgentStartRunRequest,
} from '../../../../../src/core/assistant/runtimeContracts'
import { runAgentSchemaMigrations } from './migrations'
import { AgentPersistenceStore } from './store'

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
})
