import { captureEventSchema, captureLogPageSchema, type CaptureEvent, type CaptureLogPage, type CapturePayload } from './events'
import { type ClockSegment } from './clock'
import type { ApplicationRef } from '../application-control/identifiers'

/** Session clock origin is supplied by the media coordinator, in the same monoUs domain as all tracks. */
export class CaptureLogCollector {
  private state: 'idle' | 'recording' | 'paused' | 'stopped' = 'idle'
  private at = 0
  private seq = 0
  private pausedUs = 0
  private startedAtUs = 0
  private gapAt = 0
  private pending: CaptureEvent[] = []
  private clocks: ClockSegment[] = []
  private writer = Promise.resolve()
  private failure: unknown
  private outstanding = 0
  private sealing = false
  constructor(private readonly context: { ownerRef: ApplicationRef; sourceDigest: string; originUs: number; id(): string }, private readonly write: (page: CaptureLogPage) => Promise<void>, private readonly pressure: (error: unknown) => void) {}
  private time(monoUs: number): number {
    const relative = monoUs - this.context.originUs
    if (!Number.isSafeInteger(relative) || relative < 0) throw new Error('采集时钟无效')
    this.at = Math.max(relative, this.at)
    return this.at
  }
  private open(at: number, mode: 'hold' | 'gap'): void { this.clocks.push({ id: this.context.id(), monoSpanUs: [at, at + 1], mode, start: null, end: null, anchors: [] }) }
  start(monoUs: number): void {
    if (this.state !== 'idle') throw new Error('采集已开始')
    const at = this.time(monoUs); this.startedAtUs = at; this.open(at, 'hold'); this.state = 'recording'; this.record(monoUs, { kind: 'control', action: 'start' })
  }
  record(monoUs: number, payload: CapturePayload): CaptureEvent | undefined {
    if (this.state !== 'recording') return
    const at = this.time(monoUs); const clock = this.clocks.at(-1)!
    clock.monoSpanUs[1] = Math.max(clock.monoSpanUs[1], at + 1)
    const event = captureEventSchema.parse({ ...payload, eventId: this.context.id(), seq: this.seq++, monoUs: at, recordingUs: at - this.startedAtUs - this.pausedUs, timeline: null, clockSegmentRef: clock.id, unavailableReason: 'static' })
    this.pending.push(event)
    if (this.pending.length >= 256) this.seal()
    return event
  }
  pause(monoUs: number): void {
    if (this.state !== 'recording') return
    this.record(monoUs, { kind: 'control', action: 'pause' })
    this.state = 'paused'; this.gapAt = this.at + 1; this.open(this.gapAt, 'gap'); this.seal()
  }
  resume(monoUs: number): void {
    if (this.state !== 'paused') throw new Error('采集未暂停')
    const at = Math.max(this.time(monoUs), this.gapAt + 1); this.at = at
    this.clocks.at(-1)!.monoSpanUs[1] = at
    this.pausedUs += at - this.gapAt
    this.open(at, 'hold'); this.state = 'recording'
    this.record(this.context.originUs + at, { kind: 'control', action: 'resume' })
  }
  async stop(monoUs: number): Promise<void> {
    if (this.state === 'recording') this.record(monoUs, { kind: 'control', action: 'stop' })
    else if (this.state === 'paused') {
      const at = Math.max(this.time(monoUs), this.gapAt + 1); this.at = at
      this.clocks.at(-1)!.monoSpanUs[1] = at
      // Boundary control is the only permitted event in a gap.
      this.pending.push({ kind: 'control', action: 'stop', eventId: this.context.id(), seq: this.seq++, monoUs: at, recordingUs: at - this.startedAtUs - this.pausedUs - (at - this.gapAt), timeline: null, unavailableReason: 'gap', clockSegmentRef: this.clocks.at(-1)!.id })
    }
    this.state = 'stopped'; await this.flush()
  }
  private seal(): void {
    if (!this.pending.length) return
    const entries = this.pending; this.pending = []
    const page = captureLogPageSchema.parse({ version: 2, kind: 'events', ownerRef: this.context.ownerRef, sourceDigest: this.context.sourceDigest, entries, count: entries.length, monoSpanUs: [entries[0].monoUs, entries.at(-1)!.monoUs], seqSpan: [entries[0].seq, entries.at(-1)!.seq], clockSegments: structuredClone(this.clocks) })
    // Keep only the current segment. Sealed pages retain complete facts for crash recovery.
    this.clocks = [this.clocks.at(-1)!]
    this.outstanding++
    this.writer = this.writer.then(async () => {
      if (this.failure) return
      try { await this.write(page) } catch (error) { this.failure = error; this.pressure(error) }
    }).finally(() => { this.outstanding-- })
    if (this.outstanding >= 4 && !this.sealing) {
      this.sealing = true
      try { this.pressure(new Error('采集日志保存积压，请暂停录制')) } finally { this.sealing = false }
    }
  }
  async flush(): Promise<void> { this.seal(); await this.writer; if (this.failure) throw this.failure }
}
