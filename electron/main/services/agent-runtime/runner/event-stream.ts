import { randomUUID } from 'node:crypto'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
  type AgentEventInput,
} from '../../../../../src/core/assistant/events'

export type AgentEventListener = (event: AgentEvent) => void

interface PendingModelDelta {
  stepId: string
  /** 正文与思维链必须各自成块；合并后就再也分不开了。 */
  channel: 'text' | 'reasoning'
  text: string
  fragmentCount: number
  startedAt: number
}

export interface AgentEventStreamOptions {
  /** 原始模型增量聚合后的最大字符数，必须小于事件 schema 的 16 KiB 上限。 */
  deltaMaxCharacters?: number
  /** 聚合窗口；窗口内的原始增量不会提前获得耐久 sequence。 */
  deltaFlushIntervalMs?: number
  /** 即使只有一个慢速片段，也必须在此延迟内发布，保证用户仍能看到实时反馈。 */
  deltaMaxLatencyMs?: number
  /** 至少积累多少个原始增量后，定时器才允许刷新，避免慢流退化为逐 token 落库。 */
  deltaMinFragments?: number
  now?: () => number
  /** 事件接收端异常必须交回 Runner 受控终止，不能改变 sequence 或逃逸到事件循环。 */
  onDispatchError?: (error: unknown) => void
}

const DEFAULT_DELTA_MAX_CHARACTERS = 4 * 1024
const DEFAULT_DELTA_FLUSH_INTERVAL_MS = 80
const DEFAULT_DELTA_MAX_LATENCY_MS = 240
const DEFAULT_DELTA_MIN_FRAGMENTS = 4

export class AgentEventStream {
  private sequence = 0
  private readonly listeners = new Set<AgentEventListener>()
  private readonly history: AgentEvent[] = []
  private readonly deltaMaxCharacters: number
  private readonly deltaFlushIntervalMs: number
  private readonly deltaMaxLatencyMs: number
  private readonly deltaMinFragments: number
  private readonly now: () => number
  private readonly onDispatchError: (error: unknown) => void
  private pendingDelta: PendingModelDelta | null = null
  private deltaTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly runId: string, options: AgentEventStreamOptions = {}) {
    this.deltaMaxCharacters = Math.max(
      1,
      Math.min(16 * 1024, options.deltaMaxCharacters ?? DEFAULT_DELTA_MAX_CHARACTERS)
    )
    this.deltaFlushIntervalMs = Math.max(1, options.deltaFlushIntervalMs ?? DEFAULT_DELTA_FLUSH_INTERVAL_MS)
    this.deltaMaxLatencyMs = Math.max(
      this.deltaFlushIntervalMs,
      options.deltaMaxLatencyMs ?? DEFAULT_DELTA_MAX_LATENCY_MS
    )
    this.deltaMinFragments = Math.max(2, options.deltaMinFragments ?? DEFAULT_DELTA_MIN_FRAGMENTS)
    this.now = options.now ?? Date.now
    this.onDispatchError = options.onDispatchError ?? (() => undefined)
  }

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

  /**
   * Provider 的原始文本片段先在这里合并，再统一分配 AgentEvent sequence。
   * 因此实时发布、内存历史和 SQLite 持久层看到的是同一条连续事件流，
   * 不会因为“只跳过 ModelDelta 落库”制造无法区分的 sequence 缺口。
   */
  emit(input: AgentEventInput): AgentEvent | null {
    if (input.type === 'ModelDelta') return this.enqueueModelDelta(input)
    this.flushPendingDelta()
    return this.emitNow(input)
  }

  flushPendingDelta(): AgentEvent | null {
    const pending = this.pendingDelta
    if (!pending) return null
    this.pendingDelta = null
    this.clearDeltaTimer()
    return this.emitNow({
      type: 'ModelDelta',
      stepId: pending.stepId,
      text: pending.text,
      channel: pending.channel,
    })
  }

  private enqueueModelDelta(
    input: Extract<AgentEventInput, { type: 'ModelDelta' }>
  ): AgentEvent | null {
    if (!input.text) return null
    let lastEmitted: AgentEvent | null = null
    const channel = input.channel ?? 'text'
    if (this.pendingDelta
      && (this.pendingDelta.stepId !== input.stepId || this.pendingDelta.channel !== channel)) {
      lastEmitted = this.flushPendingDelta()
    }

    let remaining = input.text
    while (remaining.length > 0) {
      this.pendingDelta ??= {
        stepId: input.stepId,
        channel,
        text: '',
        fragmentCount: 0,
        startedAt: this.now(),
      }
      const available = this.deltaMaxCharacters - this.pendingDelta.text.length
      const fragment = remaining.slice(0, available)
      this.pendingDelta.text += fragment
      this.pendingDelta.fragmentCount += 1
      remaining = remaining.slice(fragment.length)

      if (this.pendingDelta.text.length >= this.deltaMaxCharacters) {
        lastEmitted = this.flushPendingDelta()
      }
    }

    const pending = this.pendingDelta
    if (!pending) return lastEmitted
    if (
      pending.fragmentCount >= this.deltaMinFragments
      && this.now() - pending.startedAt >= this.deltaFlushIntervalMs
    ) {
      return this.flushPendingDelta()
    }
    if (pending.fragmentCount === this.deltaMinFragments) {
      this.clearDeltaTimer()
    }
    this.scheduleDeltaFlush()
    return lastEmitted
  }

  private scheduleDeltaFlush(): void {
    if (this.deltaTimer || !this.pendingDelta) return
    const elapsed = this.now() - this.pendingDelta.startedAt
    const targetLatency = this.pendingDelta.fragmentCount >= this.deltaMinFragments
      ? this.deltaFlushIntervalMs
      : this.deltaMaxLatencyMs
    const delay = Math.max(0, targetLatency - elapsed)
    this.deltaTimer = setTimeout(() => {
      try {
        this.deltaTimer = null
        if (!this.pendingDelta) return
        const pendingElapsed = this.now() - this.pendingDelta.startedAt
        if (
          this.pendingDelta.fragmentCount >= this.deltaMinFragments
          || pendingElapsed >= this.deltaMaxLatencyMs
        ) {
          this.flushPendingDelta()
          return
        }
        this.scheduleDeltaFlush()
      } catch (error) {
        this.reportDispatchError(error)
      }
    }, delay)
  }

  private clearDeltaTimer(): void {
    if (!this.deltaTimer) return
    clearTimeout(this.deltaTimer)
    this.deltaTimer = null
  }

  private emitNow(input: AgentEventInput): AgentEvent {
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
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.reportDispatchError(error)
      }
    }
    return event
  }

  private reportDispatchError(error: unknown): void {
    try {
      this.onDispatchError(error)
    } catch {
      // 故障上报本身不能再次逃逸；Runner 的错误状态已由回调负责记录。
    }
  }
}
