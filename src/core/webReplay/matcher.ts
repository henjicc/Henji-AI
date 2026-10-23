import type { StoredBody, WebRecordingCall, WebRecordingHostCall, WebRecordingHttpCall, WireBodyValue } from './schema'

export interface HttpRequestShape { method: string; url: string; body?: WireBodyValue }

/** sha256 hex of bytes given as base64; injected so this module stays free of Node APIs. */
export type DigestBase64 = (base64: string) => string

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    u.search = new URLSearchParams(params).toString()
    return u.href
  } catch { return url }
}

function storedBodyKey(body: StoredBody | undefined): string {
  if (!body) return ''
  return 'text' in body ? `t:${body.text}` : `b:${body.blob}`
}

function wireBodyKey(body: WireBodyValue | undefined, digest: DigestBase64): string {
  if (!body) return ''
  return 'text' in body ? `t:${body.text}` : `b:${digest(body.base64)}`
}

/** Stable JSON: object keys sorted, so argument order in the app's literal does not matter. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
}

export type MatchQuality = 'exact' | 'loose'
export interface MatchResult<C> { call: C; quality: MatchQuality }

class Queues<C> {
  private map = new Map<string, C[]>()
  add(key: string, call: C): void { const list = this.map.get(key); if (list) list.push(call); else this.map.set(key, [call]) }
  take(key: string, used: ReadonlySet<unknown>): C | undefined {
    const list = this.map.get(key)
    while (list?.length) { const call = list.shift()!; if (!used.has(call)) return call }
    return undefined
  }
}

/**
 * Pairs replay-time boundary calls with recorded ones. Each fingerprint has its own queue so
 * concurrent requests that start in a different order still meet their own response. A request
 * whose body changed (timestamps, ids) falls back to the next unused call with the same method
 * and URL; that is reported as `loose` instead of failing.
 */
export class WebRecordingMatcher {
  private httpExact = new Queues<WebRecordingHttpCall>()
  private httpLoose = new Queues<WebRecordingHttpCall>()
  private hostExact = new Queues<WebRecordingHostCall>()
  private hostLoose = new Queues<WebRecordingHostCall>()
  private used = new Set<WebRecordingCall>()
  private readonly all: readonly WebRecordingCall[]

  constructor(calls: readonly WebRecordingCall[], private readonly digest: DigestBase64) {
    this.all = calls
    for (const call of calls) {
      if (call.kind === 'http') {
        this.httpExact.add(`${call.method} ${normalizeUrl(call.url)} ${storedBodyKey(call.body)}`, call)
        this.httpLoose.add(`${call.method} ${normalizeUrl(call.url)}`, call)
      } else {
        this.hostExact.add(`${call.command} ${canonicalJson(call.args)}`, call)
        this.hostLoose.add(call.command, call)
      }
    }
  }

  http(request: HttpRequestShape): MatchResult<WebRecordingHttpCall> | null {
    const method = request.method.toUpperCase()
    const url = normalizeUrl(request.url)
    const exact = this.httpExact.take(`${method} ${url} ${wireBodyKey(request.body, this.digest)}`, this.used)
    const call = exact ?? this.httpLoose.take(`${method} ${url}`, this.used)
    if (!call) return null
    this.used.add(call)
    return { call, quality: exact ? 'exact' : 'loose' }
  }

  host(command: string, args: unknown): MatchResult<WebRecordingHostCall> | null {
    const exact = this.hostExact.take(`${command} ${canonicalJson(args)}`, this.used)
    const call = exact ?? this.hostLoose.take(command, this.used)
    if (!call) return null
    this.used.add(call)
    return { call, quality: exact ? 'exact' : 'loose' }
  }

  /** Recorded calls the replay never asked for (informational, not a conflict). */
  unused(): WebRecordingCall[] { return this.all.filter(c => !this.used.has(c)) }
}
