import { describe, expect, it } from 'vitest'

import { agentEventSchema } from './events'
import { AGENT_ACTIVE_TOOL_LIMIT } from './toolBudget'
import { agentTurnSnapshotDraftSchema } from './turn'

/**
 * 活动工具数量是一个不变量，但它有三个消费方：运行时的激活逻辑、`ContextUpdated` 事件、
 * 以及保存点草稿。三处各写一份的后果实测过一次——运行时上限从 8 提到 16，另外两处仍然
 * 硬编码 12，于是**每一次运行都在发出模型请求之前就被 schema 挡下**，界面上只显示一句
 * "Invalid input"，看不出跟工具数有任何关系。
 *
 * 这两条用例守的就是"满载的一轮必须能通过全部契约"。以后再调上限，漏改哪一处都会在这里失败。
 */

function toolReferences(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index}`,
    version: 1,
    schemaDigest: 'a'.repeat(64),
  }))
}

function snapshotDraft(toolCount: number) {
  return {
    version: 'agent-turn-snapshot/v1',
    runId: 'run-budget',
    threadId: 'thread-budget',
    turn: 1,
    projectionVersion: 'agent-context-message/v1',
    compactionVersion: 'agent-semantic-summary/v1',
    models: (['primary', 'router', 'summarizer'] as const).map((role) => ({
      role,
      providerId: 'test',
      modelId: 'test-model',
      apiProtocol: 'openai-chat',
    })),
    tools: toolReferences(toolCount),
    scopeRevisions: {
      navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0, settings: 0, surface: 0,
    },
    artifactRefs: [],
    requestOptions: {
      contextWindow: 128_000,
      maxOutputTokens: 4_096,
      timeoutMs: 60_000,
      approvalMode: 'ask',
    },
  }
}

describe('活动工具预算', () => {
  it('保存点草稿容得下满载的一轮', () => {
    const parsed = agentTurnSnapshotDraftSchema.safeParse(snapshotDraft(AGENT_ACTIVE_TOOL_LIMIT))
    expect(parsed.success).toBe(true)
  })

  it('ContextUpdated 事件容得下满载的一轮', () => {
    const parsed = agentEventSchema.safeParse({
      schemaVersion: 'agent-event/v1',
      eventId: 'event-budget',
      occurredAt: new Date().toISOString(),
      type: 'ContextUpdated',
      runId: 'run-budget',
      sequence: 1,
      turn: 1,
      snapshotRevision: 1,
      activeToolNames: Array.from({ length: AGENT_ACTIVE_TOOL_LIMIT }, (_, index) => `tool_${index}`),
      estimatedTokens: 1_000,
    })
    expect(parsed.success).toBe(true)
  })

  it('超出上限仍然会被拒绝，上限不是摆设', () => {
    expect(agentTurnSnapshotDraftSchema.safeParse(snapshotDraft(AGENT_ACTIVE_TOOL_LIMIT + 1)).success)
      .toBe(false)
  })
})
