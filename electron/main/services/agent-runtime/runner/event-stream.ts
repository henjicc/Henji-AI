import { randomUUID } from 'node:crypto'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
  type AgentEventInput,
} from '../../../../../src/core/assistant/events'

export type AgentEventListener = (event: AgentEvent) => void

export class AgentEventStream {
  private sequence = 0
  private readonly listeners = new Set<AgentEventListener>()
  private readonly history: AgentEvent[] = []

  constructor(readonly runId: string) {}

  get lastSequence(): number {
    return this.sequence
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getHistory(): AgentEvent[] {
    return [...this.history]
  }

  emit(input: AgentEventInput): AgentEvent {
    this.sequence += 1
    const event = agentEventSchema.parse({
      ...input,
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: randomUUID(),
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
      runId: this.runId,
    })
    this.history.push(event)
    if (this.history.length > 2_000) this.history.shift()
    for (const listener of this.listeners) listener(event)
    return event
  }
}
