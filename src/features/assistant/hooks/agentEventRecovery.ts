import type { AgentEvent } from '@/core/assistant/events'

export interface ContiguousAgentEventBatch {
  events: AgentEvent[]
  coveredThroughSequence: number
  hasGap: boolean
}

export interface AgentSnapshotRecoveryBaseline {
  coveredThroughSequence: number
  requiresCatchUp: boolean
}

export function deriveAgentSnapshotRecoveryBaseline(
  stateSequence: number,
  events: AgentEvent[]
): AgentSnapshotRecoveryBaseline {
  const coveredThroughSequence = events[events.length - 1]?.sequence ?? 0
  return {
    coveredThroughSequence,
    requiresCatchUp: coveredThroughSequence < stateSequence,
  }
}

/** 补拉页是服务端耐久事实；与实时缓冲重叠时按 sequence 覆盖本地副本。 */
export function mergeAgentEventReplay(
  pending: AgentEvent[],
  replayed: AgentEvent[]
): AgentEvent[] {
  const bySequence = new Map<number, AgentEvent>()
  for (const event of pending) bySequence.set(event.sequence, event)
  for (const event of replayed) bySequence.set(event.sequence, event)
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

/**
 * 只把从当前游标开始连续的事件交给 reducer。高序号事件先留在调用方缓冲，
 * 避免 reducer 先应用未来状态后，再把补拉到的旧事件仅当作历史展示。
 */
export function collectContiguousAgentEvents(
  afterSequence: number,
  incoming: AgentEvent[]
): ContiguousAgentEventBatch {
  const bySequence = new Map<number, AgentEvent>()
  for (const event of incoming) {
    if (event.sequence <= afterSequence) continue
    const existing = bySequence.get(event.sequence)
    if (existing && existing.eventId !== event.eventId) {
      return { events: [], coveredThroughSequence: afterSequence, hasGap: true }
    }
    bySequence.set(event.sequence, event)
  }

  const ordered = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
  const events: AgentEvent[] = []
  let cursor = afterSequence
  for (const event of ordered) {
    if (event.sequence !== cursor + 1) {
      return { events, coveredThroughSequence: cursor, hasGap: true }
    }
    events.push(event)
    cursor = event.sequence
  }
  return { events, coveredThroughSequence: cursor, hasGap: false }
}
