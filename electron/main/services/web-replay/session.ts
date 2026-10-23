import crypto from 'node:crypto'
import { WebRecordingAssembler } from '../../../../src/core/webReplay/assemble'
import { WEB_RECORDING_MIN_READER_VERSION, WEB_RECORDING_VERSION, type AppInfoValue, type ProbeMessageValue, type WebRecordingEnvironment, type WebRecordingManifest, type WebRecordingResources } from '../../../../src/core/webReplay/schema'
import { createMainLogger } from '../logging'
import { WebRecordingStore } from './store'

const logger = createMainLogger('main.web_replay.recording')
const monoUs = (): number => Number(process.hrtime.bigint() / 1000n)
const EXTERNAL_CONCURRENCY = 4

export type FetchExternal = (url: string, userAgent: string) => Promise<{ status: number; contentType: string; bytes: Uint8Array }>
export interface RecordingTarget { app: AppInfoValue; host: WebRecordingManifest['host']; env: WebRecordingEnvironment; probe: WebRecordingManifest['probe'] }

/**
 * One recording from start to finalization. The probe reloads after `start`, so the session
 * outlives the socket that requested it and is re-attached when the reloaded page says hello.
 */
export class WebRecordingSession {
  readonly id = crypto.randomUUID()
  readonly store = WebRecordingStore.forId(this.id)
  private assembler = new WebRecordingAssembler(this.store.storeBody)
  private manifest: WebRecordingManifest
  private resources: WebRecordingResources['entries'] = []
  private externalQueue: string[] = []
  private externalSeen = new Set<string>()
  private externalActive = 0
  private externalIdle: Array<() => void> = []
  private bestRttUs = Infinity
  private pings = new Map<number, number>()
  private nextPing = 1
  private stopped: { resolve: (m: WebRecordingManifest) => void; reject: (e: Error) => void; promise: Promise<WebRecordingManifest> } | null = null
  private journal: Promise<void> = Promise.resolve()
  state: 'starting' | 'recording' | 'stopping' | 'complete' | 'interrupted' = 'starting'
  /** Wall-clock ms when the probe reported the recording page started. */
  startedAt: number | null = null

  constructor(target: RecordingTarget, private readonly fetchExternal: FetchExternal) {
    this.manifest = {
      version: WEB_RECORDING_VERSION, minReaderVersion: WEB_RECORDING_MIN_READER_VERSION, id: this.id, status: 'recording', createdAt: new Date().toISOString(),
      app: target.app, probe: target.probe, host: target.host, env: target.env, wallAtZeroMs: 0, durationUs: 0, clock: null, fonts: [], warnings: [],
    }
  }

  get info(): WebRecordingManifest { return this.manifest }

  async prepare(): Promise<void> {
    await this.store.prepare()
    await this.store.writeManifest(this.manifest)
  }

  /** Returns a ping to send, or null when enough samples are in. */
  ping(): { type: 'ping'; id: number } | null {
    const id = this.nextPing++
    this.pings.set(id, monoUs())
    return { type: 'ping', id }
  }

  handle(message: ProbeMessageValue): void {
    switch (message.type) {
      case 'started':
        this.state = 'recording'
        this.startedAt = Date.now()
        this.manifest = { ...this.manifest, wallAtZeroMs: message.wallAtZeroMs, env: message.env }
        logger.info('网页录制开始', { event: 'web_replay.recording.started', context: { recordingId: this.id, app: this.manifest.app.name, url: message.env.url } })
        return
      case 'pong': {
        const sent = this.pings.get(message.id)
        if (sent === undefined) return
        this.pings.delete(message.id)
        const received = monoUs()
        const rtt = received - sent
        if (rtt < this.bestRttUs) {
          this.bestRttUs = rtt
          this.manifest.clock = { monoAtZeroUs: (sent + received) / 2 - message.now * 1000, uncertaintyUs: Math.ceil(rtt / 2) }
        }
        return
      }
      case 'storage': this.track(this.store.writeStorage(message.snapshot)); return
      case 'events':
        this.journal = this.journal.then(() => this.store.appendJournal(message.events.map(e => JSON.stringify(e)).join('\n') + '\n')).catch(error => logger.warn('网页录制日志写入失败', { event: 'web_replay.journal.failed', context: { recordingId: this.id }, error: String(error) }))
        for (const event of message.events) this.assembler.add(event)
        for (const url of this.assembler.externalUrls()) this.enqueueExternal(url)
        return
      case 'resource': {
        const stored = this.store.storeBody(message.body)
        const blob = 'blob' in stored ? stored : this.store.putBytes(Buffer.from(stored.text, 'utf8'))
        this.resources.push({ url: message.url, status: message.status, contentType: message.contentType, ...blob })
        return
      }
      case 'stopped':
        this.manifest.fonts = message.fonts
        void this.finalize('complete')
        return
      case 'error':
        this.assembler.warn({ t: this.assembler.durationUs, kind: 'error', message: message.message })
        return
      case 'hello': return
    }
  }

  /** Resolves once the probe has sent its resources and every file is written. */
  stop(send: (message: { type: 'stop'; session: string }) => boolean, timeoutMs = 60_000): Promise<WebRecordingManifest> {
    if (this.stopped) return this.stopped.promise
    let resolve!: (m: WebRecordingManifest) => void
    let reject!: (e: Error) => void
    const promise = new Promise<WebRecordingManifest>((a, b) => { resolve = a; reject = b })
    this.stopped = { resolve, reject, promise }
    this.state = 'stopping'
    if (!send({ type: 'stop', session: this.id })) void this.finalize('interrupted')
    else setTimeout(() => { if (this.state === 'stopping') void this.finalize('interrupted') }, timeoutMs)
    return promise
  }

  /** The socket went away without stopping; keep what arrived so far. */
  disconnected(): void { if (this.state === 'stopping') void this.finalize('interrupted') }

  private pendingWrites: Promise<unknown>[] = []
  private track(write: Promise<unknown>): void { this.pendingWrites.push(write.catch(error => logger.warn('网页录制文件写入失败', { event: 'web_replay.write.failed', context: { recordingId: this.id }, error: String(error) }))) }

  private enqueueExternal(url: string): void {
    if (this.externalSeen.has(url)) return
    this.externalSeen.add(url)
    this.externalQueue.push(url)
    this.pumpExternal()
  }

  private pumpExternal(): void {
    while (this.externalActive < EXTERNAL_CONCURRENCY && this.externalQueue.length) {
      const url = this.externalQueue.shift()!
      this.externalActive += 1
      void this.fetchExternal(url, this.manifest.env.userAgent).then(
        result => this.assembler.setFetched(url, { ok: true, status: result.status, contentType: result.contentType, ...this.store.putBytes(result.bytes) }),
        error => this.assembler.setFetched(url, { ok: false, message: String((error as Error)?.message ?? error) }),
      ).finally(() => {
        this.externalActive -= 1
        this.pumpExternal()
        if (!this.externalActive && !this.externalQueue.length) this.externalIdle.splice(0).forEach(fn => fn())
      })
    }
  }

  private async finalize(status: 'complete' | 'interrupted'): Promise<void> {
    if (this.state === 'complete' || this.state === 'interrupted') return
    this.state = status
    try {
      if (this.externalActive || this.externalQueue.length) await new Promise<void>(resolve => this.externalIdle.push(resolve))
      await this.journal
      await Promise.all(this.pendingWrites)
      await this.store.writeData(this.assembler.data())
      await this.store.writeBehavior(this.assembler.behaviorEvents())
      await this.store.writeResources({ entries: this.resources })
      await this.store.flushBlobs()
      this.manifest = { ...this.manifest, status, durationUs: this.assembler.durationUs, warnings: this.assembler.warnings.slice() }
      await this.store.writeManifest(this.manifest)
      logger.info('网页录制已保存', { event: 'web_replay.recording.completed', context: { recordingId: this.id, status, durationUs: this.manifest.durationUs, calls: this.assembler.data().calls.length, resources: this.resources.length, warnings: this.manifest.warnings.length } })
      this.stopped?.resolve(this.manifest)
    } catch (error) {
      logger.error('网页录制保存失败', { event: 'web_replay.recording.failed', context: { recordingId: this.id }, error: String(error) })
      this.stopped?.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
