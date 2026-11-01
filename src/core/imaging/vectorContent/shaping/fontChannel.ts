import type { TextFontSession, FontReader, TextFontRequest } from './fontSession'
import type { FontFaceInfo } from '../../../fonts/catalog'

export interface FontPort {
  onmessage: ((event: { data: FontMessage }) => void) | null
  postMessage(message: FontMessage, transfer?: ArrayBuffer[]): void
  start(): void
  close(): void
}
type Stamp = { sessionId: number; requestId: number; generation: number; revision: number }
type FontResult = Awaited<ReturnType<FontReader>>
export type FontMessage = Stamp & (
  | { kind: 'prepare'; font?: TextFontRequest }
  | { kind: 'ready'; platform: 'win32' | 'darwin'; faces?: readonly FontFaceInfo[] }
  | { kind: 'payload'; result?: FontResult }
  | { kind: 'failed'; error: string }
  | { kind: 'cancel' | 'dispose' }
)
export interface FontSnapshot { revision: number; platform: 'win32' | 'darwin'; faces?: readonly FontFaceInfo[]; read: FontReader; close(): void }

/** 端口回调直接处理资源，不能串到等待这些资源的渲染队列中。 */
export function serveFontChannel(port: FontPort, capture: () => Promise<FontSnapshot>, failed: (error: unknown) => void): () => void {
  const sessions = new Map<number, { generation: number; snapshot: Promise<FontSnapshot>; requests: Set<number> }>()
  let closed = false
  const dispose = (sessionId: number): void => {
    const entry = sessions.get(sessionId)
    if (!entry) return
    sessions.delete(sessionId)
    void entry.snapshot.then(snapshot => snapshot.close(), () => undefined)
  }
  port.onmessage = ({ data: message }) => {
    if (closed) return
    if (message.kind === 'dispose') { dispose(message.sessionId); return }
    if (message.kind === 'cancel') { sessions.get(message.sessionId)?.requests.delete(message.requestId); return }
    if (message.kind !== 'prepare') return
    let entry = sessions.get(message.sessionId)
    if (!entry && !message.font) {
      entry = { generation: message.generation, snapshot: capture(), requests: new Set() }
      sessions.set(message.sessionId, entry)
    }
    if (!entry || entry.generation !== message.generation) return
    const current = entry
    current.requests.add(message.requestId)
    const active = (): boolean => !closed && sessions.get(message.sessionId) === current && current.requests.has(message.requestId)
    void current.snapshot.then(async snapshot => {
      if (!active()) return
      if (!message.font) {
        port.postMessage({ ...message, kind: 'ready', revision: snapshot.revision, platform: snapshot.platform, faces: snapshot.faces })
      } else {
        if (snapshot.revision !== message.revision) throw new Error('字体快照已经变化，请重新准备')
        const result = await snapshot.read(message.font)
        if (!active()) return
        port.postMessage({ ...message, kind: 'payload', result }, result ? [result.bytes] : [])
      }
    }).catch(error => {
      if (!active()) return
      failed(error)
      port.postMessage({ ...message, kind: 'failed', error: error instanceof Error ? error.message : String(error) })
    }).finally(() => current.requests.delete(message.requestId))
  }
  port.start()
  return () => { if (closed) return; port.postMessage({ kind: 'dispose', sessionId: 0, requestId: 0, generation: 0, revision: -1 }); closed = true; for (const id of sessions.keys()) dispose(id); port.onmessage = null; port.close() }
}

export interface TextFontLease { readonly fonts: TextFontSession; readonly revision: number; release(): void }
export class TextFontChannel {
  private nextSession = 0
  private nextRequest = 0
  private closed = false
  private readonly pending = new Map<number, { stamp: Stamp; resolve(message: FontMessage): void; reject(error: unknown): void }>()
  private readonly releases = new Map<number, () => void>()
  constructor(private readonly port: FontPort) {
    port.onmessage = ({ data: message }) => {
      if (message.kind === 'dispose' && message.sessionId === 0) { this.close(); return }
      const pending = this.pending.get(message.requestId)
      if (!pending || pending.stamp.sessionId !== message.sessionId || pending.stamp.generation !== message.generation) return
      if (message.kind !== 'ready' && message.revision !== pending.stamp.revision) return
      this.pending.delete(message.requestId)
      if (message.kind === 'failed') pending.reject(new Error(message.error)); else pending.resolve(message)
    }
    port.start()
  }
  private request(stamp: Omit<Stamp, 'requestId'>, font?: TextFontRequest, signal?: AbortSignal): Promise<FontMessage> {
    if (this.closed) return Promise.reject(new Error('字体通道已经关闭'))
    if (signal?.aborted) return Promise.reject(signal.reason)
    const request = { ...stamp, requestId: ++this.nextRequest }
    return new Promise<FontMessage>((resolve, reject) => {
      const abort = (): void => { this.pending.delete(request.requestId); this.port.postMessage({ ...request, kind: 'cancel' }); reject(signal?.reason) }
      const settle = (): void => signal?.removeEventListener('abort', abort)
      this.pending.set(request.requestId, { stamp: request, resolve: message => { settle(); resolve(message) }, reject: error => { settle(); reject(error) } })
      signal?.addEventListener('abort', abort, { once: true })
      try { this.port.postMessage({ ...request, kind: 'prepare', font }) }
      catch (error) { this.pending.delete(request.requestId); settle(); reject(error) }
    })
  }
  async open(signal?: AbortSignal, Session?: typeof import('./fontPolicy').TextFontSession): Promise<TextFontLease> {
    const sessionId = ++this.nextSession
    const stamp = { sessionId, generation: 1, revision: -1 }
    let fonts: TextFontSession | undefined, released = false
    const release = (): void => {
      if (released) return
      released = true; fonts?.close(); this.releases.delete(sessionId)
      for (const [id, pending] of this.pending) if (pending.stamp.sessionId === sessionId) { this.pending.delete(id); pending.reject(new Error('字体租约已经释放')) }
      this.port.postMessage({ ...stamp, requestId: 0, kind: 'dispose' })
    }
    this.releases.set(sessionId, release)
    try {
      const ready = await this.request(stamp, undefined, signal)
      if (released || this.closed) throw new Error('字体租约已经释放')
      if (ready.kind !== 'ready') throw new Error('字体快照未返回就绪消息')
      stamp.revision = ready.revision
      const Factory = Session ?? (await import('./fontPolicy')).TextFontSession
      fonts = new Factory(ready.platform, async request => {
        const payload = await this.request(stamp, request)
        if (payload.kind !== 'payload') throw new Error('字体通道未返回字节')
        return payload.result
      }, ready.faces)
      return { fonts, revision: ready.revision, release }
    } catch (error) { release(); throw error }
  }
  close(): void {
    if (this.closed) return
    for (const release of this.releases.values()) release()
    this.closed = true; this.port.onmessage = null; this.port.close()
  }
}
