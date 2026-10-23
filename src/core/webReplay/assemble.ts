import type { ExternalResource, ProbeEventValue, StoredBody, WebRecordingBehaviorEvent, WebRecordingData, WebRecordingHostCall, WebRecordingHttpCall, WebRecordingManifest, WireBodyValue } from './schema'

type Warning = WebRecordingManifest['warnings'][number]
type BehaviorWire = Extract<ProbeEventValue, { kind: WebRecordingBehaviorEvent['kind'] }>

const BEHAVIOR_KINDS = new Set<string>(['pointer', 'wheel', 'key', 'text', 'paste', 'drop', 'resize', 'focus', 'action'])

/**
 * Folds the probe's event stream into the stored tracks. Pure apart from `store`, which turns a
 * wire body into a stored one (bytes go to the blob store). Safe to feed in arrival batches.
 */
export class WebRecordingAssembler {
  private http = new Map<number, WebRecordingHttpCall>()
  private host = new Map<number, WebRecordingHostCall>()
  private callbacks: WebRecordingData['callbacks'] = []
  private external = new Map<string, ExternalResource>()
  private random: WebRecordingData['random'] = { math: [], uuid: [], bytes: [] }
  private clipboard: WebRecordingData['clipboard'] = []
  private behavior: WebRecordingBehaviorEvent[] = []
  readonly warnings: Warning[] = []
  private lastSeq = -1
  durationUs = 0

  constructor(private readonly store: (body: WireBodyValue) => StoredBody) {}

  add(event: ProbeEventValue): void {
    if (event.seq <= this.lastSeq) return // reconnect resend
    this.lastSeq = event.seq
    this.durationUs = Math.max(this.durationUs, event.t)
    if (BEHAVIOR_KINDS.has(event.kind)) { this.behavior.push(this.storeBehavior(event as BehaviorWire)); return }
    switch (event.kind) {
      case 'http.request':
        this.http.set(event.id, { kind: 'http', id: event.id, t: event.t, via: event.via, method: event.method, url: event.url, headers: event.headers, ...(event.body ? { body: this.store(event.body) } : {}), chunks: [] })
        return
      case 'http.response': {
        const call = this.http.get(event.id)
        if (call) call.response = { at: event.t - call.t, status: event.status, statusText: event.statusText, url: event.url, headers: event.headers }
        return
      }
      case 'http.chunk': { const call = this.http.get(event.id); if (call) call.chunks.push({ at: event.t - call.t, body: this.store(event.body) }); return }
      case 'http.end': { const call = this.http.get(event.id); if (call) call.endAt = event.t - call.t; return }
      case 'http.error': { const call = this.http.get(event.id); if (call) call.error = { at: event.t - call.t, phase: event.phase, name: event.name, message: event.message }; return }
      case 'host.call': this.host.set(event.id, { kind: 'host', id: event.id, t: event.t, command: event.command, args: event.args }); return
      case 'host.result': {
        const call = this.host.get(event.id)
        if (call) call.result = event.ok ? { at: event.t - call.t, ok: true, value: event.value } : { at: event.t - call.t, ok: false, error: event.error }
        return
      }
      case 'host.callback': if (event.call !== null) this.callbacks.push({ t: event.t, call: event.call, index: event.index, payload: event.payload }); return
      case 'external': {
        const known = this.external.get(event.url)
        const next: ExternalResource = { ...known, url: event.url, t: known?.t ?? event.t, initiator: known?.initiator ?? event.initiator }
        if (event.outcome) next.outcome = event.outcome
        if (event.width) next.width = event.width
        if (event.height) next.height = event.height
        this.external.set(event.url, next)
        return
      }
      case 'random':
        if (event.source === 'math') this.random.math.push(...event.values)
        else if (event.source === 'uuid') this.random.uuid.push(...event.values)
        else this.random.bytes.push(...event.values)
        return
      case 'clipboard.read': this.clipboard.push({ t: event.t, text: event.text }); return
      case 'boundary': this.warnings.push({ t: event.t, kind: 'boundary', message: `${event.boundary}: ${event.detail}` }); return
    }
  }

  /** External URLs Henji still has to fetch, in first-seen order. */
  externalUrls(): string[] { return [...this.external.values()].filter(r => !r.fetched).map(r => r.url) }

  setFetched(url: string, fetched: NonNullable<ExternalResource['fetched']>): void {
    const known = this.external.get(url)
    if (known) known.fetched = fetched
  }

  warn(warning: Warning): void { this.warnings.push(warning) }

  data(): WebRecordingData {
    const calls = [...this.http.values(), ...this.host.values()].sort((a, b) => a.t - b.t || a.id - b.id)
    return { calls, callbacks: this.callbacks.slice(), external: [...this.external.values()], random: { math: this.random.math.slice(), uuid: this.random.uuid.slice(), bytes: this.random.bytes.slice() }, clipboard: this.clipboard.slice() }
  }

  behaviorEvents(): WebRecordingBehaviorEvent[] { return this.behavior.slice() }

  private storeBehavior(event: BehaviorWire): WebRecordingBehaviorEvent {
    const { seq: _seq, ...rest } = event
    if (rest.kind === 'paste' || rest.kind === 'drop') return { ...rest, files: rest.files.map(f => ({ ...f, body: this.store(f.body) })) } as WebRecordingBehaviorEvent
    return rest as WebRecordingBehaviorEvent
  }
}
