import { clockSegmentSchema, type ClockSegment, type Timeline } from '@/core/creativeIntent/contracts'
import { explanationEventSchema, explanationSessionSchema, type ExplanationEvent, type ExplanationSession } from '@/core/creativeIntent/schema'
import { creativeIntentPageSchema, type CreativeIntentPage } from '@/core/creativeIntent/pages'

type EventPayload = ExplanationEvent extends infer E ? E extends ExplanationEvent ? Omit<E, 'eventId' | 'seq' | 'monoUs' | 'timeline' | 'clockSegmentRef' | 'unavailableReason'> : never : never
export interface RecordingPresentation { timeline: Omit<Timeline, 'visitRef'> | null; requestedFrame: number | null; playing: boolean; direction: -1 | 0 | 1; rate: number; scrubbing: boolean }
/** Host-neutral append-only collector. One bounded page per event kind; I/O is injected. */
export class RecordingCollector {
  readonly session: ExplanationSession
  private seq = 0
  private visit = 0
  private at = 0
  private current?: ClockSegment
  private picture?: RecordingPresentation
  private pending = new Map<ExplanationEvent['kind'], ExplanationEvent[]>()
  private writer = Promise.resolve()
  private failure?: unknown
  private outstanding = 0
  private failedPages: CreativeIntentPage[] = []
  private direction = 0
  private flushing = Promise.resolve()
  constructor(session: ExplanationSession, private readonly write: (page: CreativeIntentPage) => Promise<void>, private readonly pressure: (message: string) => void) {
    this.session = explanationSessionSchema.parse(structuredClone(session))
    this.at = this.session.clockSegments.at(-1)?.monoSpanUs[1] ?? 0
    this.visit = this.session.clockSegments.length
    if (this.session.state === 'paused') this.current = this.session.clockSegments.at(-1)
    this.seq = this.session.pages.reduce((n, p) => Math.max(n, p.seqSpan[1] + 1), 0)
  }
  get nextSeq(): number { return this.seq }
  private time(at: number): number { if (!Number.isSafeInteger(at) || at < 0) throw new Error('采集时间无效。'); this.at = Math.max(this.at, at); return this.at }
  private timeline(): Timeline | null { return this.picture?.timeline ? { ...this.picture.timeline, visitRef: `${this.session.id}/visit-${this.visit}` } : null }
  private open(at: number, mode: ClockSegment['mode'], start: Timeline | null, end = start): ClockSegment {
    const segment: ClockSegment = { id: crypto.randomUUID(), monoSpanUs: [at, at + (mode === 'seek' ? 0 : 1)], mode, start, end, anchors: [] }
    this.session.clockSegments.push(segment); this.current = segment; return segment
  }
  private extend(at: number): void { if (this.current && this.current.mode !== 'seek') this.current.monoSpanUs[1] = Math.max(this.current.monoSpanUs[0] + 1, at) }
  presented(at: number, picture: RecordingPresentation, action: 'present' | 'play' | 'pause' | 'scrub' | 'seek' | 'rate' = 'present'): void {
    if (this.session.state !== 'recording') return
    at = this.time(at)
    const before = this.timeline(); const change = picture.timeline && before ? picture.timeline.frame - before.frame : 0
    const direction = Math.sign(change)
    const identityChanged = Boolean(before && picture.timeline && (before.sequenceRef.id !== picture.timeline.sequenceRef.id || before.fps.numerator !== picture.timeline.fps.numerator || before.fps.denominator !== picture.timeline.fps.denominator))
    const seek = identityChanged || action === 'seek' || Boolean(change && !picture.playing && !picture.scrubbing) || Boolean(direction && this.direction && direction !== this.direction)
    // A transition needs a positive preceding interval, even within one microsecond.
    if (this.current) at = this.time(Math.max(at, this.current.monoSpanUs[1]))
    this.extend(at)
    if (seek) { this.visit++; this.picture = picture; this.open(at, 'seek', identityChanged ? null : before, identityChanged ? null : this.timeline()); this.current = undefined }
    else this.picture = picture
    const timeline = this.timeline(); const mode = picture.playing ? 'play' : picture.scrubbing ? 'scrub' : 'hold'
    if (!this.current || this.current.mode !== mode || Boolean(this.current.start) !== Boolean(timeline) || this.current.anchors.at(-1)?.playbackRate !== picture.rate || mode === 'hold' && this.current.start?.frame !== timeline?.frame) this.open(at, mode, timeline)
    this.current!.end = timeline; this.current!.monoSpanUs[1] = at + 1
    const anchor = { monoUs: at, presentedFrame: timeline?.frame ?? null, requestedFrame: picture.requestedFrame, sequenceRef: timeline?.sequenceRef ?? null, visitRef: timeline?.visitRef ?? null, playbackDirection: picture.direction, playbackRate: picture.rate, playing: picture.playing, epoch: this.visit, uncertaintyUs: 0 }
    // All receipts are in timeline pages. Header keeps only endpoints, not an hour of anchors.
    this.current!.anchors = this.current!.anchors.length ? [this.current!.anchors[0], anchor] : [anchor]
    if (direction) this.direction = direction
    this.record(at, { kind: 'timeline', intent: 'navigate', requestedFrame: picture.requestedFrame, action, playbackRate: picture.rate })
  }
  start(at: number): void { this.session.state = 'recording'; this.open(this.time(at), 'hold', null); this.record(at, { kind: 'control', action: 'start-recording' }) }
  pause(at: number, focus = false): void {
    if (this.session.state !== 'recording') return
    at = this.time(at); this.record(at, { kind: 'control', action: focus ? 'focus-lost' : 'pause-recording' }); at = Math.max(at + 1, this.current!.monoSpanUs[1]); this.extend(at); this.session.state = 'paused'; this.picture = undefined; this.open(at, 'gap', null); this.seal()
  }
  resume(at: number): void {
    if (!['paused', 'recoverable'].includes(this.session.state)) throw new Error('当前讲解不能继续录制。')
    at = this.time(at)
    const last = this.session.clockSegments.at(-1)
    if (!this.current && last) this.open(last.monoSpanUs[1], 'gap', null)
    at = Math.max(at, (this.current?.monoSpanUs[0] ?? at) + 1); this.extend(at); this.current = undefined; this.picture = undefined; this.direction = 0; this.visit++; this.session.state = 'recording'; this.open(at, 'hold', null)
    this.record(at, { kind: 'control', action: 'resume-recording' })
  }
  stop(at: number): void {
    if (this.session.state === 'recording') this.record(at, { kind: 'control', action: 'stop-recording' })
    this.extend(this.time(at)); this.session.state = 'reviewing'; this.seal()
  }
  record(at: number, payload: EventPayload): ExplanationEvent | undefined {
    if (this.session.state !== 'recording') return undefined
    at = this.time(at); this.extend(at + 1)
    const timeline = this.timeline()
    const event = explanationEventSchema.parse({ ...payload, eventId: crypto.randomUUID(), seq: this.seq++, monoUs: at, timeline, clockSegmentRef: this.current!.id, ...(!timeline ? { unavailableReason: this.session.mode === 'static' ? 'static' : 'missing-presentation' } : {}) })
    this.append(event); return event
  }
  reserve(at: number): Pick<ExplanationEvent, 'eventId' | 'seq' | 'monoUs' | 'timeline' | 'clockSegmentRef' | 'unavailableReason'> | undefined {
    if (this.session.state !== 'recording') return undefined
    at = this.time(at); this.extend(at + 1); const timeline = this.timeline()
    return { eventId: crypto.randomUUID(), seq: this.seq++, monoUs: at, timeline, clockSegmentRef: this.current!.id, ...(!timeline ? { unavailableReason: this.session.mode === 'static' ? 'static' as const : 'missing-presentation' as const } : {}) }
  }
  append(event: ExplanationEvent): void {
    this.seq = Math.max(this.seq, event.seq + 1)
    const entries = this.pending.get(event.kind) ?? []; entries.push(event); this.pending.set(event.kind, entries)
    if (entries.length >= 256) this.sealKind(event.kind)
  }
  private sealKind(kind: ExplanationEvent['kind'], checkPressure = true): void {
    const entries = this.pending.get(kind); if (!entries?.length) return
    const ordered = [...entries].sort((a, b) => a.monoUs - b.monoUs || a.seq - b.seq)
    const page = creativeIntentPageSchema.parse({ version: 1, kind, ownerRef: this.session.ownerRef, sourceDigest: this.session.sourceDigest, count: ordered.length, monoSpanUs: [ordered[0].monoUs, ordered.at(-1)!.monoUs], seqSpan: [ordered[0].seq, ordered.at(-1)!.seq], entries: ordered })
    this.pending.delete(kind); this.outstanding++
    this.writer = this.writer.then(async () => { if (this.failure) this.failedPages.push(page); else { try { await this.write(page) } catch (error) { this.failedPages.push(page); this.failure = error; this.pressure('讲解尚未保存，请暂停后重试保存。') } } this.outstanding-- })
    if (checkPressure && this.outstanding >= 4) this.pressure('正在保存讲解，录制已暂停；保存完成后可继续。')
  }
  // A normal flush seals several small event kinds at once. That fan-out is not sustained I/O pressure.
  // Full-page production while writes are pending still applies the bounded in-flight backpressure.
  seal(): void { for (const kind of this.pending.keys()) this.sealKind(kind, false) }
  flush(): Promise<void> {
    const next = this.flushing.catch(() => undefined).then(() => this.flushPages())
    this.flushing = next
    return next
  }
  private async flushPages(): Promise<void> {
    this.seal(); await this.writer
    if (this.failure) {
      const pending = [...this.failedPages]; this.failedPages = []; this.failure = undefined
      for (let i = 0; i < pending.length; i++) { try { await this.write(pending[i]) } catch (error) { this.failedPages.push(...pending.slice(i)); this.failure = error; throw error } }
    }
    for (const clock of this.session.clockSegments) clockSegmentSchema.parse(clock)
  }
}
