import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentSessionCompactionPayload } from '../../../../../src/core/assistant/session'
import { runAgentSchemaMigrations } from './migrations'
import { AgentSessionStore } from './session-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

function compactionPayload(
  coveredThroughSequence = 4,
  userIntent = '继续完成持续会话'
): AgentSessionCompactionPayload {
  return {
    summary: {
      version: 'agent-semantic-summary/v1',
      userIntent,
      userConstraints: ['使用中文'],
      confirmedDecisions: ['采用线性会话'],
      openQuestions: ['下一步是什么'],
      contextNotes: [],
    },
    coveredFromSequence: 1,
    coveredThroughSequence,
    providerId: 'provider',
    modelId: 'summarizer',
    usage: {
      inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 5, textTokens: 5, reasoningTokens: 0, totalTokens: 15,
    },
    fallbackReason: null,
  }
}

describeWithElectronSqlite('AgentSessionStore compaction', () => {
  let database: Database.Database
  let store: AgentSessionStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES ('thread-1', '测试', 1, 1, NULL)
    `).run()
    database.prepare(`
      INSERT INTO agent_runs(
        run_id, thread_id, goal, request_json, state_json, status,
        checkpoint_version, checkpoint_json, recovery_status,
        parent_run_id, created_at, updated_at
      ) VALUES ('run-1', 'thread-1', '测试', '{}', '{}', 'completed',
        'agent-checkpoint/v1', '{}', 'none', NULL, 1, 1)
    `).run()
    store = new AgentSessionStore(database)
  })

  afterEach(() => { database.close() })

  it('以最新 compaction 替代覆盖区间并保留之后的完整消息', () => {
    for (let index = 1; index <= 8; index += 1) {
      store.appendMessage({
        threadId: 'thread-1', runId: 'run-1',
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `消息-${index}`, idempotencyKey: `message-${index}`, createdAt: index,
      })
    }
    store.appendCompaction({
      threadId: 'thread-1', runId: 'run-1', turn: 2,
      payload: compactionPayload(), idempotencyKey: 'compaction-4', createdAt: 20,
    })
    store.appendCompaction({
      threadId: 'thread-1', runId: 'run-1', turn: 2,
      payload: compactionPayload(), idempotencyKey: 'compaction-4', createdAt: 20,
    })

    const projection = store.projectConversation('thread-1')
    expect(projection.messages[0]?.content).toContain('SESSION_SEMANTIC_SUMMARY')
    expect(projection.messages.slice(1).map((message) => message.content)).toEqual([
      '消息-5', '消息-6', '消息-7', '消息-8',
    ])
    expect(store.getHead('thread-1')).toBe(9)
  })

  it('连续两次压缩时只投影最新语义摘要和未覆盖消息', () => {
    for (let index = 1; index <= 8; index += 1) {
      store.appendMessage({
        threadId: 'thread-1', runId: 'run-1',
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `消息-${index}`, idempotencyKey: `twice-message-${index}`, createdAt: index,
      })
    }
    store.appendCompaction({
      threadId: 'thread-1', runId: 'run-1', turn: 2,
      payload: compactionPayload(4, '第一次压缩'), idempotencyKey: 'compaction-first', createdAt: 20,
    })
    store.appendCompaction({
      threadId: 'thread-1', runId: 'run-1', turn: 4,
      payload: compactionPayload(6, '第二次压缩，保留使用中文约束'), idempotencyKey: 'compaction-second', createdAt: 30,
    })

    const projection = store.projectConversation('thread-1')
    expect(projection.messages[0]?.content).toContain('第二次压缩')
    expect(projection.messages[0]?.content).not.toContain('第一次压缩')
    expect(projection.messages.slice(1).map((message) => message.content)).toEqual(['消息-7', '消息-8'])
    expect(store.getHead('thread-1')).toBe(10)
  })
})
