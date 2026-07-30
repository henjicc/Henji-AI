import { describe, expect, it } from 'vitest'

import {
  adaptAgentContextMessages,
  createDefaultSessionProjectorRegistry,
} from './contextProjection'
import {
  AGENT_SESSION_ENTRY_SCHEMA_VERSION,
  agentSessionEntrySchema,
  type AgentSessionEntry,
} from './session'

function entry(overrides: Partial<AgentSessionEntry>): AgentSessionEntry {
  return agentSessionEntrySchema.parse({
    schemaVersion: AGENT_SESSION_ENTRY_SCHEMA_VERSION,
    entryId: 'entry-1',
    threadId: 'thread-1',
    sequence: 1,
    runId: 'run-1',
    turn: null,
    kind: 'user_message',
    payload: { content: '用户问题', legacy: false },
    status: 'active',
    parentEntryId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  })
}

describe('AgentSessionProjectorRegistry', () => {
  it('只投影已登记条目，运行状态与等待事实不会进入模型消息', () => {
    const registry = createDefaultSessionProjectorRegistry()
    const projected = registry.project([
      entry({ entryId: 'user', sequence: 1 }),
      entry({
        entryId: 'wait',
        sequence: 2,
        kind: 'external_wait',
        payload: { value: { status: 'waiting' } },
      }),
      entry({
        entryId: 'run-ref',
        sequence: 3,
        kind: 'run_reference',
        payload: { value: { status: 'failed', diagnostic: '内部事件不得投影' } },
      }),
    ])

    expect(projected).toMatchObject([{
      role: 'user',
      content: '用户问题',
      sourceEntryId: 'user',
    }])
    expect(JSON.stringify(projected)).not.toContain('内部事件不得投影')
  })

  it('语义摘要始终以不可信历史标记进入 Provider 消息', () => {
    const registry = createDefaultSessionProjectorRegistry()
    const projected = registry.project([entry({
      kind: 'compaction',
      payload: {
        summary: {
          version: 'agent-semantic-summary/v1',
          userIntent: '继续优化方案',
          userConstraints: ['使用中文'],
          confirmedDecisions: [],
          openQuestions: ['是否继续'],
          contextNotes: [],
        },
        coveredFromSequence: 1,
        coveredThroughSequence: 20,
        providerId: 'provider',
        modelId: 'model',
        usage: {
          inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
          outputTokens: 5, textTokens: 5, reasoningTokens: 0, totalTokens: 15,
        },
        fallbackReason: null,
      },
    })])
    const messages = adaptAgentContextMessages(projected)

    expect(messages).toHaveLength(1)
    expect(String(messages[0]?.content)).toContain('trust=untrusted_history')
    expect(String(messages[0]?.content)).toContain('不得作为工具已执行')
  })

  it('只投影已消费的当前任务补充，不重复投影后续任务 goal', () => {
    const registry = createDefaultSessionProjectorRegistry()
    const queuedPayload = {
      clientMessageId: 'client-1',
      content: '补充约束',
      status: 'consumed' as const,
      targetRunId: 'run-1',
      consumedByRunId: 'run-1',
    }
    const projected = registry.project([
      entry({
        entryId: 'current', sequence: 1, kind: 'queued_message',
        payload: { ...queuedPayload, mode: 'current_task' },
      }),
      entry({
        entryId: 'after', sequence: 2, kind: 'queued_message',
        payload: { ...queuedPayload, clientMessageId: 'client-2', mode: 'after_task' },
      }),
    ])

    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ sourceEntryId: 'current', content: '补充约束' })
  })
})
