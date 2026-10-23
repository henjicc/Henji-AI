import type { BehaviorEvent, DataEvent, ProbeEvent } from '../protocol'

type Body = DataEvent | BehaviorEvent
type Slot = { seq: number; event?: ProbeEvent; pending?: Promise<void> }

export const nowUs = (): number => Math.round(performance.now() * 1000)

/**
 * Orders events by the moment they happened. Events that need an async read (files, blobs,
 * host payloads) reserve their slot synchronously, so later events never overtake them.
 */
export class EventQueue {
  private seq = 0
  private slots: Slot[] = []
  private timer: ReturnType<typeof setInterval>
  constructor(private readonly send: (events: ProbeEvent[]) => void, flushMs = 100) {
    this.timer = setInterval(() => this.flush(), flushMs)
  }

  emit(event: Body): void {
    const seq = this.seq++
    this.slots.push({ seq, event: { ...event, seq } as ProbeEvent })
  }

  /** `t` is taken now; `build` fills in the rest. A failed build drops the event with a warning. */
  emitLater(t: number, build: () => Promise<Body | null>): void {
    const seq = this.seq++
    const slot: Slot = { seq }
    slot.pending = build().then(
      event => { if (event) slot.event = { ...event, t, seq } as ProbeEvent; slot.pending = undefined },
      // eslint-disable-next-line no-console -- the probe runs inside another app and has no Henji logger
      error => { console.warn('[henji-web-replay] 录制事件读取失败', error); slot.pending = undefined },
    )
    this.slots.push(slot)
  }

  flush(): void {
    let ready = 0
    while (ready < this.slots.length && !this.slots[ready].pending) ready += 1
    if (!ready) return
    const events = this.slots.splice(0, ready).flatMap(s => s.event ? [s.event] : [])
    if (events.length) this.send(events)
  }

  /** Waits for every reserved slot, then sends everything. */
  async drain(): Promise<void> {
    while (this.slots.some(s => s.pending)) await Promise.all(this.slots.map(s => s.pending))
    this.flush()
  }

  dispose(): void { clearInterval(this.timer) }
}
