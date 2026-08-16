import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runAgentSchemaMigrations } from '../agent-runtime/persistence/migrations'
import { AgentTraceStore } from './agent-trace-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

const usage = {
  inputTokens: 100,
  inputNoCacheTokens: 80,
  cacheReadTokens: 20,
  cacheWriteTokens: 0,
  outputTokens: 25,
  textTokens: 20,
  reasoningTokens: 5,
  totalTokens: 125,
}

describeWithElectronSqlite('AgentTraceStore', () => {
  let database: Database.Database | undefined
  let store: AgentTraceStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    const now = Date.now()
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES ('thread-1', '追踪测试', ?, ?, 'run-1')
    `).run(now, now)
    database.prepare(`
      INSERT INTO agent_runs(
        run_id, thread_id, goal, request_json, state_json, status,
        checkpoint_version, checkpoint_json, recovery_status,
        parent_run_id, created_at, updated_at
      ) VALUES ('run-1', 'thread-1', '检查模型上下文', '{}', '{}', 'running', 'v1', '{}', 'none', NULL, ?, ?)
    `).run(now, now)
    store = new AgentTraceStore(database)
  })

  afterEach(() => {
    database?.close()
  })

  it('按运行聚合模型步骤并按需读取详情', () => {
    const startedAt = new Date().toISOString()
    store.start({
      traceId: 'trace-1',
      runId: 'run-1',
      requestId: 'run-1:step-1',
      stepId: 'step-1',
      kind: 'primary',
      turn: 1,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      startedAt,
      captureMode: 'detailed',
    })
    store.complete({
      traceId: 'trace-1',
      completedAt: new Date(Date.parse(startedAt) + 800).toISOString(),
      elapsedMs: 800,
      finishReason: 'stop',
      usage,
      detail: {
        schemaVersion: 'agent-trace/v1',
        logicalRequest: {
          system: '系统提示词',
          messages: [{ role: 'user', content: '检查上下文' }],
          output: { mode: 'text' },
          capabilities: { streaming: true },
          providerOptions: { provider: { apiKey: 'secret-key' } },
        },
        httpRequest: {
          method: 'POST',
          url: 'https://example.test/v1/chat?api_key=secret-key',
          headers: { Authorization: 'Bearer secret-key' },
          body: { password: 'secret-password' },
        },
        response: {
          text: '完成',
          reasoningText: '',
          structuredOutput: null,
          toolCalls: [],
          responseMessages: [{ role: 'assistant', content: '完成' }],
          finishReason: 'stop',
          usage,
          providerMetadataSummary: {},
          warnings: [],
        },
        capture: {
          truncated: false,
          originalBytes: 500,
          storedBytes: 500,
          sections: [],
        },
      },
    })

    const result = store.query({ limit: 50 })
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      goal: '检查模型上下文',
      requestCount: 1,
      completedCount: 1,
    })
    expect(result.runs[0].usage.totalTokens).toBe(125)
    const detail = store.getDetail('trace-1')?.detail
    expect(detail?.logicalRequest.system).toBe('系统提示词')
    expect(detail?.logicalRequest.providerOptions).toEqual({ provider: { apiKey: '***' } })
    expect(detail?.httpRequest?.url).toContain('api_key=***')
    expect(detail?.httpRequest?.headers.Authorization).toBe('***')
    expect(detail?.httpRequest?.body).toEqual({ password: '***' })
  })

  it('应用重启恢复时把运行中追踪标记为中断', () => {
    store.start({
      traceId: 'trace-running',
      runId: 'run-1',
      requestId: 'run-1:step-2',
      stepId: 'step-2',
      kind: 'primary',
      turn: 2,
      providerId: 'provider',
      modelId: 'model',
      startedAt: new Date().toISOString(),
      captureMode: 'summary',
    })
    store.markInterrupted()
    expect(store.query({ limit: 50 }).runs[0].steps[0].status).toBe('interrupted')
  })

  it('运行摘要以权威运行终态为准，可选标题失败不得覆盖主任务成功', () => {
    const startedAt = new Date().toISOString()
    store.start({
      traceId: 'trace-title', runId: 'run-1', requestId: 'thread-title:thread-1:1',
      stepId: 'thread-title:1', kind: 'summarizer', providerId: 'provider', modelId: 'model',
      startedAt, captureMode: 'summary',
    })
    store.fail({
      traceId: 'trace-title', completedAt: new Date(Date.parse(startedAt) + 10).toISOString(),
      elapsedMs: 10, status: 'failed', usage, error: { message: '标题模型失败' },
    })
    store.start({
      traceId: 'trace-primary', runId: 'run-1', requestId: 'run-1:step-1',
      stepId: 'step-1', kind: 'primary', turn: 1, providerId: 'provider', modelId: 'model',
      startedAt, captureMode: 'summary',
    })
    store.complete({
      traceId: 'trace-primary', completedAt: new Date(Date.parse(startedAt) + 20).toISOString(),
      elapsedMs: 20, finishReason: 'stop', usage,
    })
    database?.prepare("UPDATE agent_runs SET status = 'completed' WHERE run_id = 'run-1'").run()

    expect(store.query({ limit: 50 }).runs[0]).toMatchObject({
      status: 'completed', requestCount: 2, completedCount: 1, failedCount: 1,
    })
  })

  it('失败摘要在写入数据库前再次脱敏', () => {
    const startedAt = new Date().toISOString()
    store.start({
      traceId: 'trace-failed',
      runId: 'run-1',
      requestId: 'run-1:step-3',
      stepId: 'step-3',
      kind: 'primary',
      turn: 3,
      providerId: 'provider',
      modelId: 'model',
      startedAt,
      captureMode: 'summary',
    })
    store.fail({
      traceId: 'trace-failed',
      completedAt: new Date(Date.parse(startedAt) + 50).toISOString(),
      elapsedMs: 50,
      status: 'failed',
      usage,
      error: {
        name: 'Error',
        message: 'Authorization: Bearer secret-token',
      },
    })

    const step = store.query({ limit: 50 }).runs[0].steps[0]
    expect(step.errorMessage).not.toContain('secret-token')
    expect(step.errorMessage).toContain('***')
  })
})
