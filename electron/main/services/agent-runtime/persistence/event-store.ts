import type Database from 'better-sqlite3'

import {
  agentEventSchema,
  type AgentEvent,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import {
  agentRunEventsPageSchema,
  type AgentRunEventsPage,
} from '../../../../../src/core/assistant/runtimeContracts'

interface EventRow {
  event_json: string
}

interface EventBoundsRow {
  oldest_sequence: number | null
  latest_sequence: number | null
}

export interface AgentStoredEventPage {
  events: AgentEvent[]
  oldestSequence: number | null
  latestSequence: number
}

export function buildAgentRunEventsPage(
  runId: string,
  afterSequence: number,
  state: Pick<AgentRunState, 'sequence' | 'status'>,
  stored: AgentStoredEventPage
): AgentRunEventsPage {
  const latestSequence = Math.max(state.sequence, stored.latestSequence)
  let expectedSequence = afterSequence + 1
  let pageHasGap = false
  for (const event of stored.events) {
    if (event.sequence !== expectedSequence) {
      pageHasGap = true
      break
    }
    expectedSequence += 1
  }
  const hasGap = afterSequence > latestSequence
    || pageHasGap
    || (stored.events.length === 0 && afterSequence < latestSequence)
  const coveredThroughSequence = hasGap
    ? afterSequence
    : (stored.events.at(-1)?.sequence ?? Math.min(afterSequence, latestSequence))
  return agentRunEventsPageSchema.parse({
    runId,
    afterSequence,
    events: stored.events,
    oldestSequence: stored.oldestSequence,
    latestSequence,
    coveredThroughSequence,
    hasGap,
    hasMore: !hasGap && coveredThroughSequence < latestSequence,
    terminal: ['completed', 'failed', 'cancelled'].includes(state.status),
  })
}

function parseStoredEvent(row: EventRow): AgentEvent {
  return agentEventSchema.parse(JSON.parse(row.event_json) as unknown)
}

/** SQLite 中只保存已经分配连续 sequence 的耐久事件。原始模型 delta 在上游先合并。 */
export class AgentEventStore {
  constructor(private readonly database: Database.Database) {}

  append(event: AgentEvent): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO agent_events(run_id, sequence, event_id, event_json, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      event.runId,
      event.sequence,
      event.eventId,
      JSON.stringify(event),
      Date.parse(event.occurredAt)
    )
  }

  loadTail(runId: string, limit = 2_000): AgentEvent[] {
    const safeLimit = Math.max(1, Math.min(2_000, limit))
    const rows = this.database.prepare(`
      SELECT event_json
      FROM (
        SELECT sequence, event_json
        FROM agent_events
        WHERE run_id = ?
        ORDER BY sequence DESC
        LIMIT ?
      )
      ORDER BY sequence ASC
    `).all(runId, safeLimit) as EventRow[]
    return rows.map(parseStoredEvent)
  }

  loadAfter(runId: string, afterSequence: number, limit: number): AgentStoredEventPage {
    const safeAfterSequence = Math.max(0, Math.trunc(afterSequence))
    const safeLimit = Math.max(1, Math.min(2_000, Math.trunc(limit)))
    const rows = this.database.prepare(`
      SELECT event_json
      FROM agent_events
      WHERE run_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(runId, safeAfterSequence, safeLimit) as EventRow[]
    const bounds = this.database.prepare(`
      SELECT MIN(sequence) AS oldest_sequence, MAX(sequence) AS latest_sequence
      FROM agent_events
      WHERE run_id = ?
    `).get(runId) as EventBoundsRow
    return {
      events: rows.map(parseStoredEvent),
      oldestSequence: bounds.oldest_sequence,
      latestSequence: bounds.latest_sequence ?? 0,
    }
  }
}
