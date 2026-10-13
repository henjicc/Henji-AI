import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createModelTraceTablesV1 } from './traceSchema'
import { AgentTraceStore } from './agent-trace-store'

// 本文件只验证内存数据库，诊断日志不能写入用户资料目录。
vi.mock('./main-logger', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }) }))

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
    createModelTraceTablesV1(database)
    database.prepare(`INSERT INTO model_trace_contexts (run_id, thread_id, goal, status) VALUES ('run-1', 'thread-1', '检查模型上下文', 'running')`).run()
    store = new AgentTraceStore(database)
  })

  afterEach(() => {
    database?.close()
  })

  it.each([1, 2, 3])('复合游标以每页 %i 条遍历同毫秒边界，无遗漏或重复', (limit) => {
    const now = Date.now()
    const ids = ['trace-a', 'trace-z', 'trace-b', 'trace-y', 'trace-c']
    for (const traceId of ids) {
      store.start({ traceId, runId: 'run-1', requestId: traceId, stepId: traceId, kind: 'primary',
        providerId: 'test', modelId: 'test', startedAt: new Date(now).toISOString(), captureMode: 'summary' })
      store.complete({ traceId, completedAt: new Date(now + 10).toISOString(), elapsedMs: 10, usage })
    }
    store.start({ traceId: 'older', runId: 'run-1', requestId: 'older', stepId: 'older', kind: 'primary',
      providerId: 'test', modelId: 'test', startedAt: new Date(now - 1).toISOString(), captureMode: 'summary' })
    const seen: string[] = []
    let page = store.query({ limit })
    for (let requests = 0; requests < 6; requests++) {
      seen.push(...page.runs.flatMap(run => run.steps.map(step => step.traceId)))
      if (!page.hasMore) break
      expect(page).toHaveProperty('nextBeforeTraceId')
      page = store.query({ limit, beforeTimestamp: page.nextBeforeTimestamp, beforeTraceId: page.nextBeforeTraceId })
    }
    expect(seen).toHaveLength(6)
    expect(new Set(seen)).toEqual(new Set([...ids, 'older']))
    expect(page.hasMore).toBe(false)
    expect(page.nextBeforeTraceId).toBeUndefined()
    expect(page.nextBeforeTimestamp).toBeUndefined()
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
    database?.prepare("UPDATE model_trace_contexts SET status = 'completed' WHERE run_id = 'run-1'").run()

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
