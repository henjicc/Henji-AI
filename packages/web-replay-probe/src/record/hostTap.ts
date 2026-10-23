import { bytesToBase64 } from '../shared/body'
import { encodeValue } from '../shared/codec'
import { callbackRefs } from '../shared/tauriRefs'
import { nowUs, type EventQueue } from './events'
import { pendingSeamRequests } from './networkTap'

let nextCallId = 1
const ANY_ID: ReadonlySet<number> = { has: () => true } as unknown as ReadonlySet<number>
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Tauri v2 freezes every function on `__TAURI_INTERNALS__`, but sends each command with the global
 * `fetch` to `http://ipc.localhost/<command>` and fires host callbacks through its `callbacks` Map.
 * The probe records commands at that fetch and callbacks at the Map. `plugin:http|*` belongs to the
 * network seam and is only checked for bypasses.
 */
export function createTauriIpcTap(queue: EventQueue, isActive: () => boolean): ((original: FetchFn, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { callbacks?: Map<number, (data: unknown) => unknown> } }).__TAURI_INTERNALS__
  if (!internals) return null
  const pendingInvokeIds = new Set<number>()
  const owner = new Map<number, { call: number; index: number }>()
  const callbacks = internals.callbacks
  if (callbacks instanceof Map) {
    const get = callbacks.get.bind(callbacks)
    callbacks.get = (id: number) => {
      const fn = get(id)
      if (!fn || !isActive() || pendingInvokeIds.has(id)) return fn
      const link = owner.get(id)
      if (!link) return fn
      return (data: unknown) => {
        queue.emitLater(nowUs(), async () => ({ kind: 'host.callback', t: 0, call: link.call, index: link.index, payload: await encodeValue(data) }))
        return fn(data)
      }
    }
  }

  return async (original, input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const command = decodeURIComponent(url.pathname.slice(1))
    if (!isActive() || command.startsWith('plugin:__TAURI_CHANNEL__')) return original(input, init)
    if (command.startsWith('plugin:http|')) {
      if (command === 'plugin:http|fetch' && pendingSeamRequests() === 0) queue.emit({ kind: 'boundary', t: nowUs(), boundary: 'plugin-http', detail: '应用绕过网络出口直接调用了 Tauri HTTP 插件' })
      return original(input, init)
    }
    const headers = new Headers(init?.headers)
    const ids = [Number(headers.get('Tauri-Callback')), Number(headers.get('Tauri-Error'))].filter(Number.isFinite)
    ids.forEach(id => pendingInvokeIds.add(id))
    const body = init?.body
    const args: unknown = typeof body === 'string' ? safeJson(body) : body instanceof ArrayBuffer || ArrayBuffer.isView(body) ? body : body ?? {}
    const id = nextCallId++
    const t = nowUs()
    callbackRefs(args, ANY_ID).forEach((callbackId, index) => owner.set(callbackId, { call: id, index }))
    queue.emitLater(t, async () => ({ kind: 'host.call', id, t, command, args: await encodeValue(args) }))
    const response = await original(input, init)
    const copy = response.clone()
    const at = nowUs()
    queue.emitLater(at, async () => {
      const type = (copy.headers.get('content-type') ?? '').split(',')[0]
      const value: unknown = type === 'application/json' ? await copy.json() : type === 'text/plain' ? await copy.text() : await copy.arrayBuffer()
      ids.forEach(i => pendingInvokeIds.delete(i))
      return copy.headers.get('Tauri-Response') === 'ok'
        ? { kind: 'host.result', id, t: at, ok: true, value: await encodeValue(value) }
        : { kind: 'host.result', id, t: at, ok: false, error: await encodeValue(value) }
    })
    return response
  }
}

function safeJson(text: string): unknown { try { return JSON.parse(text) } catch { return text } }

/** Collects random values in call order; Henji replays the same sequence. */
export function installRandomTap(queue: EventQueue, isActive: () => boolean): () => void {
  const math: number[] = []
  const uuids: string[] = []
  const bytes: string[] = []
  const random = Math.random
  Math.random = () => { const v = random(); if (isActive()) math.push(v); return v }
  if (typeof crypto.randomUUID === 'function') {
    const uuid = crypto.randomUUID.bind(crypto)
    crypto.randomUUID = () => { const v = uuid(); if (isActive()) uuids.push(v); return v }
  }
  const getRandomValues = crypto.getRandomValues.bind(crypto)
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    const out = getRandomValues(array as unknown as Uint8Array<ArrayBuffer>) as unknown as T
    if (isActive() && array) bytes.push(bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)))
    return out
  }) as typeof crypto.getRandomValues
  return () => {
    const t = nowUs()
    if (math.length) queue.emit({ kind: 'random', t, source: 'math', values: math.splice(0) })
    if (uuids.length) queue.emit({ kind: 'random', t, source: 'uuid', values: uuids.splice(0) })
    if (bytes.length) queue.emit({ kind: 'random', t, source: 'bytes', values: bytes.splice(0) })
  }
}

export function installClipboardTap(queue: EventQueue, isActive: () => boolean): void {
  const clipboard = navigator.clipboard
  if (!clipboard?.readText) return
  const readText = clipboard.readText.bind(clipboard)
  clipboard.readText = async () => { const text = await readText(); if (isActive()) queue.emit({ kind: 'clipboard.read', t: nowUs(), text }); return text }
}
