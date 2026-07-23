import { describe, expect, it } from 'vitest'

import { AGENT_EVENT_SCHEMA_VERSION, agentEventSchema } from './events'
import { AGENT_RUNTIME_SCHEMA_VERSION, agentRunControlRequestSchema } from './runtimeContracts'

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
})
