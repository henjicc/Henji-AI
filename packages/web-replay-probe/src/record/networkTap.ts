import type { HeaderList } from '../protocol'
import { bytesToWire, requestBodyToWire } from '../shared/body'
import { nowUs, type EventQueue } from './events'

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Marks a call that the seam wrapper already records, so the window.fetch tap does not record it twice. */
export const SEAM_MARK = '__henjiWebReplaySeam'

let nextId = 1
let pendingSeam = 0

export function pendingSeamRequests(): number { return pendingSeam }

function headerList(headers: HeadersInit | Headers | undefined): HeaderList {
  const out: HeaderList = []
  new Headers(headers).forEach((value, key) => out.push([key, value]))
  return out
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return new URL(input, location.href).href
  if (input instanceof URL) return input.href
  return input.url
}

/** Copies the response stream as it arrives; the app receives an equivalent Response untouched. */
function observeBody(queue: EventQueue, id: number, response: Response): Response {
  if (!response.body) { queue.emit({ kind: 'http.end', id, t: nowUs() }); return response }
  const [forApp, forRecord] = response.body.tee()
  void (async () => {
    const reader = forRecord.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        queue.emit({ kind: 'http.chunk', id, t: nowUs(), body: bytesToWire(value) })
      }
      queue.emit({ kind: 'http.end', id, t: nowUs() })
    } catch (error) {
      const e = error as Error
      queue.emit({ kind: 'http.error', id, t: nowUs(), phase: 'body', name: e?.name ?? 'Error', message: String(e?.message ?? error) })
    }
  })()
  const copy = new Response(forApp, { status: response.status, statusText: response.statusText, headers: response.headers })
  Object.defineProperties(copy, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } })
  return copy
}

export async function recordFetch(queue: EventQueue, via: 'seam' | 'fetch', inner: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const id = nextId++
  const t = nowUs()
  const request = input instanceof Request ? input : undefined
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const headers = headerList(init?.headers ?? request?.headers)
  const bodySource = init?.body !== undefined ? init.body : request && request.body ? await request.clone().arrayBuffer() : undefined
  queue.emitLater(t, async () => ({ kind: 'http.request', id, t, via, method, url: urlOf(input), headers, body: await requestBodyToWire(bodySource) }))
  if (via === 'seam') pendingSeam += 1
  let response: Response
  try {
    // The seam's inner function may itself call window.fetch (browser fallback); the mark stops a second record.
    response = await inner(input, via === 'seam' ? { ...init, [SEAM_MARK]: true } as RequestInit : init)
  } catch (error) {
    const e = error as Error
    queue.emit({ kind: 'http.error', id, t: nowUs(), phase: 'request', name: e?.name ?? 'Error', message: String(e?.message ?? error) })
    throw error
  } finally {
    if (via === 'seam') pendingSeam -= 1
  }
  queue.emit({ kind: 'http.response', id, t: nowUs(), status: response.status, statusText: response.statusText, url: response.url || urlOf(input), headers: headerList(response.headers) })
  return observeBody(queue, id, response)
}

const TAURI_IPC = /^(ipc:|https?:\/\/ipc\.localhost)/

export type IpcHook = (original: FetchLike, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Wraps window.fetch for apps that call it directly. Tauri's IPC transport goes to `ipcHook` instead. */
export function installWindowFetchTap(queue: EventQueue, isActive: () => boolean, ipcHook: IpcHook | null): void {
  const original = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const marked = Boolean(init && (init as Record<string, unknown>)[SEAM_MARK])
    if (TAURI_IPC.test(urlOf(input))) return ipcHook ? ipcHook(original, input, init) : original(input, init)
    if (!isActive() || marked) return original(input, init)
    return recordFetch(queue, 'fetch', original, input, init)
  }) as typeof window.fetch
}
