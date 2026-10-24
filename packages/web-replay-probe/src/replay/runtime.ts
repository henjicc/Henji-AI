import { base64ToBytes, requestBodyToWire, wireToBytes } from '../shared/body'
import { decodeValue, encodeValue } from '../shared/codec'
import { pointIn, resolveLocator } from '../shared/locator'
import { callbackRefs, type TauriInternals } from '../shared/tauriRefs'
import type { ElementInfo, HeaderList, Locator } from '../protocol'
import { REPLAY_CONTROL, REPLAY_GLOBAL, type ReplayHost, type ReplayHttpResult } from './types'
import { installCursorOverlay } from './cursorOverlay'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const nowUs = (): number => Math.round(performance.now() * 1000)
const TAURI_IPC = /^(ipc:|https?:\/\/ipc\.localhost)/

function headerList(headers: HeadersInit | undefined): HeaderList {
  const out: HeaderList = []
  new Headers(headers).forEach((value, key) => out.push([key, value]))
  return out
}

function abortError(): DOMException { return new DOMException('The operation was aborted.', 'AbortError') }

/** Seeded generator used after the recorded random sequence runs out. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Builds the page-side Response from a recorded result, delivering chunks on the recorded schedule. */
function buildResponse(result: Extract<ReplayHttpResult, { ok: true }>, issuedUs: number, signal: AbortSignal | null | undefined): Promise<Response> {
  const wait = (atUs: number): number => Math.max(0, (issuedUs + atUs - nowUs()) / 1000)
  return new Promise((resolve, reject) => {
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const onAbort = (): void => { timers.forEach(clearTimeout); try { controller?.error(abortError()) } catch { /* closed */ } reject(abortError()) }
    if (signal?.aborted) { reject(abortError()); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (result.error?.phase === 'request') {
      const error = result.error
      timers.push(setTimeout(() => reject(Object.assign(new Error(error.message), { name: error.name })), wait(error.at)))
      return
    }
    timers.push(setTimeout(() => {
      const nullBody = [101, 204, 205, 304].includes(result.status)
      const body = nullBody ? null : new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
          for (const chunk of result.chunks) timers.push(setTimeout(() => c.enqueue(wireToBytes(chunk.body)), wait(chunk.at)))
          const error = result.error
          if (error) timers.push(setTimeout(() => c.error(Object.assign(new Error(error.message), { name: error.name })), wait(error.at)))
          else timers.push(setTimeout(() => { c.close(); signal?.removeEventListener('abort', onAbort) }, wait(result.endAt ?? result.chunks.at(-1)?.at ?? result.responseAt)))
        },
        cancel() { timers.forEach(clearTimeout) },
      })
      const response = new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers })
      Object.defineProperty(response, 'url', { value: result.url })
      resolve(response)
    }, wait(result.responseAt)))
  })
}

/**
 * Installed by Henji's replay preload before any page script. Every boundary the probe recorded is
 * answered from the recording; anything else is reported as a conflict and fails like it would offline.
 */
export function installReplayRuntime(host: ReplayHost): void {
  const boot = host.boot
  const win = window as unknown as Record<string, unknown>
  const conflict = (message: string): void => host.report({ kind: 'conflict', t: nowUs(), message })

  // ---- time: wall clock follows the recording; timers stay real in the realtime tier
  const RealDate = Date
  const wallNow = (): number => boot.wallAtZeroMs + performance.now()
  class ReplayDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(wallNow())
      else super(...(args as [number]))
    }
    static now(): number { return Math.floor(wallNow()) }
  }
  win.Date = ReplayDate

  // ---- randomness: recorded sequence first, then a fixed seed
  const seeded = mulberry32(0x5eed)
  const math = boot.random.math.slice()
  Math.random = () => (math.length ? math.shift()! : seeded())
  const uuids = boot.random.uuid.slice()
  const bytes = boot.random.bytes.slice()
  const fill = (array: Uint8Array): void => { for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(seeded() * 256) }
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array
    const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    const next = bytes.shift()
    if (next) { const recorded = base64ToBytes(next); if (recorded.length === view.length) view.set(recorded); else fill(view) } else fill(view)
    return array
  }) as typeof crypto.getRandomValues
  crypto.randomUUID = () => {
    const next = uuids.shift()
    if (next) return next as `${string}-${string}-${string}-${string}-${string}`
    const b = new Uint8Array(16); fill(b); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
  }

  // ---- network
  const originalFetch = window.fetch.bind(window)
  const replayFetch = (via: 'seam' | 'fetch') => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const issued = nowUs()
    const request = input instanceof Request ? input : undefined
    const url = typeof input === 'string' ? new URL(input, location.href).href : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const bodySource = init?.body !== undefined ? init.body : request && request.body ? await request.clone().arrayBuffer() : undefined
    const result = await host.http({ method, url, headers: headerList(init?.headers ?? request?.headers), body: await requestBodyToWire(bodySource), via })
    if (!result.ok) { conflict(result.conflict); throw new TypeError(`Failed to fetch (痕迹重演：${result.conflict})`) }
    return buildResponse(result, issued, init?.signal ?? request?.signal)
  }
  const seamFetch = replayFetch('seam')
  const windowFetch = replayFetch('fetch')
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input, location.href).href : input instanceof URL ? input.href : input.url
    // Same-origin static files are served by the replay session; everything else is a recorded call.
    if (new URL(url).origin === location.origin && (init?.method ?? 'GET').toUpperCase() === 'GET' && !TAURI_IPC.test(url)) return originalFetch(input, init)
    return windowFetch(input, init)
  }) as typeof window.fetch
  win[REPLAY_GLOBAL] = { fetch: seamFetch as FetchLike, action: (name: string) => host.report({ kind: 'action', t: nowUs(), name }) }

  // ---- clipboard
  if (navigator.clipboard) {
    const texts = boot.clipboard.slice()
    navigator.clipboard.readText = async () => texts.shift() ?? ''
    navigator.clipboard.writeText = async () => {}
  }

  // ---- calls that bypass the probe fail instead of reaching the network
  const refuse = (name: string) => function (this: unknown, ...args: unknown[]): never {
    const detail = `${name} ${String(args[0] ?? '')}`
    conflict(`重演中出现录制未接管的调用：${detail}`)
    throw new DOMException(`痕迹重演不允许 ${detail}`, 'NetworkError')
  }
  const NativeWebSocket = window.WebSocket
  win.WebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    // Vite's dev client: a socket that never connects. Closing it would make the client poll and reload the page.
    if (protocols === 'vite-hmr' || (Array.isArray(protocols) && protocols.includes('vite-hmr'))) {
      const idle = new EventTarget() as EventTarget & Record<string, unknown>
      Object.assign(idle, { url: String(url), readyState: 0, protocol: '', extensions: '', bufferedAmount: 0, binaryType: 'blob', send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null, CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
      return idle
    }
    return refuse('WebSocket').call(this, url)
  } as unknown as typeof WebSocket
  Object.assign(win.WebSocket as object, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: NativeWebSocket.prototype })
  win.EventSource = refuse('EventSource')
  XMLHttpRequest.prototype.open = refuse('XMLHttpRequest') as typeof XMLHttpRequest.prototype.open

  // ---- Tauri host
  if (boot.host === 'tauri') installTauriShim(host, conflict)

  // ---- engine control (called from main through executeJavaScript)
  const locate = (locator: Locator, offset: [number, number]): { x: number; y: number } | null => {
    const element = resolveLocator(locator, boot.locator)
    if (!element) return null
    const { x, y } = pointIn(element, offset)
    return { x, y }
  }
  win[REPLAY_CONTROL] = { locate, pointFor: (target: ElementInfo) => locate(target.locator, target.offset) }
  if (host.boot.pointer !== false) installCursorOverlay()
  host.report({ kind: 'ready', now: performance.now() })
}

function installTauriShim(host: ReplayHost, conflict: (message: string) => void): void {
  const boot = host.boot
  const callbacks = new Map<number, (payload: unknown) => void>()
  // Tauri draws callback ids from crypto.getRandomValues (two per invoke, one per transformCallback);
  // doing the same keeps the recorded random sequence aligned for the app's own random reads.
  const uid = (): number => crypto.getRandomValues(new Uint32Array(1))[0]
  const internals: TauriInternals = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    plugins: {},
    transformCallback(callback, once) {
      let id = uid()
      while (callbacks.has(id)) id = uid()
      callbacks.set(id, payload => { if (once) callbacks.delete(id); callback?.(payload) })
      return id
    },
    unregisterCallback(id: number) { callbacks.delete(id) },
    convertFileSrc(path: string, protocol = 'asset') { return `http://${protocol}.localhost/${encodeURIComponent(path)}` },
    async invoke(cmd: string, args?: unknown) {
      const issued = nowUs()
      uid(); uid() // the resolve and reject callbacks Tauri registers for every invoke
      if (cmd.startsWith('plugin:http|')) { conflict(`应用绕过网络出口调用了 ${cmd}`); throw new Error(`痕迹重演不接管 ${cmd}`) }
      const refs = callbackRefs(args, new Set(callbacks.keys()))
      // Same shape the recorder saw: Tauri sends JSON-serialized arguments (channels become `__CHANNEL__:<id>`).
      const wire = args instanceof ArrayBuffer || ArrayBuffer.isView(args) ? args : JSON.parse(JSON.stringify(args ?? {}))
      const result = await host.invoke(cmd, await encodeValue(wire))
      if (!result.ok) { conflict(result.conflict); throw new Error(result.conflict) }
      // Schedule the host callbacks this call carried during recording.
      for (const event of boot.callbacks) {
        if (event.call !== result.call) continue
        const id = refs[event.index]
        if (id === undefined) continue
        setTimeout(() => callbacks.get(id)?.(decodeValue(event.payload)), Math.max(0, event.t / 1000 - performance.now()))
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, (issued + result.at - nowUs()) / 1000)))
      if (result.resolved) return decodeValue(result.value)
      throw decodeValue(result.error)
    },
  }
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: internals, configurable: true, writable: true })
  // @tauri-apps/api's unlisten goes through this object; the host side of an unlisten is a recorded invoke.
  ;(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  ;(window as unknown as Record<string, unknown>).isTauri = true
}
