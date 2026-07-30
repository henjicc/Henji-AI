import { describe, expect, it } from 'vitest'

import { AGENT_EVENT_SCHEMA_VERSION, agentEventSchema } from './events'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentRunControlRequestSchema,
  agentRunEventsPageSchema,
  agentRunEventsRequestSchema,
} from './runtimeContracts'

describe('agent runtime contracts', () => {
  it('控制请求要求稳定版本和 runId', () => {
    expect(agentRunControlRequestSchema.parse({
      schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
      runId: 'run-1',
    })).toEqual({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId: 'run-1' })
    expect(() => agentRunControlRequestSchema.parse({ schemaVersion: 'v0', runId: 'run-1' })).toThrow()
  })

  it('事件要求严格序号、版本和关联 ID', () => {
    const event = {
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: 'event-1',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      runId: 'run-1',
      type: 'RunStarted',
      threadId: 'thread-1',
    }
    expect(agentEventSchema.parse(event)).toEqual(event)
    expect(() => agentEventSchema.parse({ ...event, sequence: 0 })).toThrow()
    expect(() => agentEventSchema.parse({ ...event, unexpected: true })).toThrow()
  })

  it('增量事件请求限制游标和页大小，响应校验 run 与顺序', () => {
    const request = agentRunEventsRequestSchema.parse({
      schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
      runId: 'run-1',
      afterSequence: 0,
    })
    expect(request.limit).toBe(500)
    expect(() => agentRunEventsRequestSchema.parse({ ...request, afterSequence: -1 })).toThrow()
    expect(() => agentRunEventsRequestSchema.parse({ ...request, limit: 2_001 })).toThrow()

    const first = agentEventSchema.parse({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: 'event-1',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      runId: 'run-1',
      type: 'RunStarted',
      threadId: 'thread-1',
    })
    const page = {
      runId: 'run-1',
      afterSequence: 0,
      events: [first],
      oldestSequence: 1,
      latestSequence: 1,
      coveredThroughSequence: 1,
      hasGap: false,
      hasMore: false,
      terminal: false,
    }
    expect(agentRunEventsPageSchema.parse(page)).toEqual(page)
    expect(() => agentRunEventsPageSchema.parse({
      ...page,
      events: [{ ...first, runId: 'run-2' }],
    })).toThrow()
    expect(() => agentRunEventsPageSchema.parse({
      ...page,
      afterSequence: 1,
    })).toThrow()
    expect(() => agentRunEventsPageSchema.parse({
      ...page,
      events: [first, { ...first, eventId: 'event-3', sequence: 3 }],
      latestSequence: 3,
      coveredThroughSequence: 3,
    })).toThrow()
  })
})
