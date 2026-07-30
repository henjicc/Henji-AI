import { describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
} from '../../../../../src/core/assistant/events'
import { buildAgentRunEventsPage } from './event-store'

function event(sequence: number): AgentEvent {
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

describe('buildAgentRunEventsPage', () => {
  it('区分正常分页与真实 sequence 缺口', () => {
    expect(buildAgentRunEventsPage(
      'run-1',
      0,
      { sequence: 4, status: 'running' },
      { events: [event(1), event(2)], oldestSequence: 1, latestSequence: 4 }
    )).toMatchObject({
      coveredThroughSequence: 2,
      latestSequence: 4,
      hasGap: false,
      hasMore: true,
      terminal: false,
    })

    expect(buildAgentRunEventsPage(
      'run-1',
      2,
      { sequence: 6, status: 'running' },
      { events: [event(5), event(6)], oldestSequence: 1, latestSequence: 6 }
    )).toMatchObject({
      coveredThroughSequence: 2,
      hasGap: true,
      hasMore: false,
    })

    expect(buildAgentRunEventsPage(
      'run-1',
      0,
      { sequence: 3, status: 'running' },
      { events: [event(1), event(3)], oldestSequence: 1, latestSequence: 3 }
    )).toMatchObject({
      coveredThroughSequence: 0,
      hasGap: true,
      hasMore: false,
    })
  })

  it('游标已到末尾时返回稳定确认点和终局标记', () => {
    expect(buildAgentRunEventsPage(
      'run-1',
      4,
      { sequence: 4, status: 'completed' },
      { events: [], oldestSequence: 1, latestSequence: 4 }
    )).toMatchObject({
      coveredThroughSequence: 4,
      latestSequence: 4,
      hasGap: false,
      hasMore: false,
      terminal: true,
    })
  })
})
