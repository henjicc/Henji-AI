import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  agentQueuedMessagePayloadSchema,
  type AgentSessionCompactionPayload,
} from '../../../../../src/core/assistant/session'
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

  it('按 clientMessageId 幂等入队并严格按 sequence 消费一次', () => {
    const first = store.enqueueMessage({
      threadId: 'thread-1', runId: 'run-1', clientMessageId: 'client-1',
      content: '先补充 A', mode: 'current_task',
    })
    const duplicate = store.enqueueMessage({
      threadId: 'thread-1', runId: 'run-1', clientMessageId: 'client-1',
      content: '不应覆盖', mode: 'current_task',
    })
    const second = store.enqueueMessage({
      threadId: 'thread-1', runId: 'run-1', clientMessageId: 'client-2',
      content: '再补充 B', mode: 'current_task',
    })

    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.entry.entryId).toBe(first.entry.entryId)
    expect(store.consumeQueuedMessages('run-1', 'current_task').map((entry) => entry.entryId))
      .toEqual([first.entry.entryId, second.entry.entryId])
    expect(store.consumeQueuedMessages('run-1', 'current_task')).toEqual([])
  })

  it('可取消待处理消息，已消费消息不会被回退', () => {
    const queued = store.enqueueMessage({
      threadId: 'thread-1', runId: 'run-1', clientMessageId: 'cancel-1',
      content: '稍后继续', mode: 'after_task',
    }).entry
    const cancelled = store.cancelQueuedMessage('thread-1', queued.entryId)
    expect(agentQueuedMessagePayloadSchema.parse(cancelled.payload)).toMatchObject({
      status: 'cancelled', statusReason: '用户取消',
    })
    expect(store.listQueuedMessages('run-1', 'after_task')).toEqual([])

    const consumedCandidate = store.enqueueMessage({
      threadId: 'thread-1', runId: 'run-1', clientMessageId: 'consume-1',
      content: '回答', mode: 'clarification', waitId: 'wait-1',
    }).entry
    expect(store.updateQueuedMessageStatus(
      consumedCandidate.entryId, 'accepted', 'consumed', undefined, 'run-1'
    )).not.toBeNull()
    const unchanged = store.cancelQueuedMessage('thread-1', consumedCandidate.entryId)
    expect(agentQueuedMessagePayloadSchema.parse(unchanged.payload).status).toBe('consumed')
  })

  it('内部模型与工具条目参与上下文但不进入普通会话分页，并形成父链', () => {
    const user = store.appendMessage({
      threadId: 'thread-1',
      runId: 'run-1',
      role: 'user',
      content: '读取真实状态',
      idempotencyKey: 'chain-user',
    })
    const model = store.appendInternalMessage({
      threadId: 'thread-1',
      runId: 'run-1',
      turn: 1,
      kind: 'model_message',
      payload: {
        message: {
          role: 'assistant',
          content: [{
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_state',
            input: {},
          }],
        },
        stepId: 'step-1',
        finishReason: 'tool-calls',
      },
      idempotencyKey: 'chain-model',
    })
    const tool = store.appendInternalMessage({
      threadId: 'thread-1',
      runId: 'run-1',
      turn: 1,
      kind: 'tool_result',
      payload: {
        message: {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_state',
            output: { type: 'json', value: { ok: true } },
          }],
        },
      },
      idempotencyKey: 'chain-tool',
    })
    const display = store.appendMessage({
      threadId: 'thread-1',
      runId: 'run-1',
      role: 'assistant',
      content: '已读取',
      contextVisible: false,
      idempotencyKey: 'chain-display',
    })

    expect(model.parentEntryId).toBe(user.entryId)
    expect(tool.parentEntryId).toBe(model.entryId)
    expect(display.parentEntryId).toBe(tool.entryId)
    expect(store.projectConversation('thread-1').messages.map((message) => message.role))
      .toEqual(['user', 'assistant', 'tool'])
    expect(store.loadTranscript('thread-1').entries.map((entry) => entry.kind))
      .toEqual(['user_message', 'assistant_message'])
  })
})
