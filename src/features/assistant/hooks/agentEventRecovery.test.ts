import { describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
} from '@/core/assistant/events'
import {
  collectContiguousAgentEvents,
  deriveAgentSnapshotRecoveryBaseline,
  mergeAgentEventReplay,
} from './agentEventRecovery'

function event(sequence: number, eventId = `event-${sequence}`): AgentEvent {
  return agentEventSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 6, 30) + sequence).toISOString(),
    runId: 'run-1',
    type: 'RunStarted',
    threadId: 'thread-1',
  })
}

describe('collectContiguousAgentEvents', () => {
  it('暂存跳号事件，补拉后按顺序推进且忽略重复重放', () => {
    expect(collectContiguousAgentEvents(0, [event(1), event(3)])).toEqual({
      events: [event(1)],
      coveredThroughSequence: 1,
      hasGap: true,
    })
    expect(collectContiguousAgentEvents(1, [event(3), event(2), event(3)])).toEqual({
      events: [event(2), event(3)],
      coveredThroughSequence: 3,
      hasGap: false,
    })
  })

  it('同一 sequence 对应不同 eventId 时拒绝静默归并', () => {
    expect(collectContiguousAgentEvents(0, [event(1), event(1, 'conflict')])).toEqual({
      events: [],
      coveredThroughSequence: 0,
      hasGap: true,
    })
  })

  it('补拉页覆盖实时缓冲中的重叠事件，避免重复渲染', () => {
    expect(mergeAgentEventReplay(
      [event(3, 'live-3'), event(4)],
      [event(2), event(3, 'durable-3')]
    )).toEqual([event(2), event(3, 'durable-3'), event(4)])
  })

  it('快照事件尾部落后于状态序号时主动要求增量追平', () => {
    expect(deriveAgentSnapshotRecoveryBaseline(3, [event(1), event(2)])).toEqual({
      coveredThroughSequence: 2,
      requiresCatchUp: true,
    })
    expect(deriveAgentSnapshotRecoveryBaseline(0, [])).toEqual({
      coveredThroughSequence: 0,
      requiresCatchUp: false,
    })
  })
})
