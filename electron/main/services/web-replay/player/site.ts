import type { Session } from 'electron'
import { normalizeUrl } from '../../../../../src/core/webReplay/matcher'
import type { ExternalResource, WebRecordingResources } from '../../../../../src/core/webReplay/schema'
import type { WebRecordingStore } from '../store'

export const BOOTSTRAP_PATH = '/__henji_web_replay_bootstrap__'
const BOOTSTRAP_HTML = '<!doctype html><meta charset="utf-8"><title>replay</title>'

function withoutHash(url: string): string { return url.split('#')[0] }

/** Requests the replay session is still answering; the lockstep engine waits for none before moving page time. */
export interface ReplaySiteLoads { inFlight(): number; idle(): Promise<void> }

/**
 * Serves the recorded app inside the replay session: same-origin files from the recording,
 * cross-origin images as Henji fetched them, and nothing from the real network.
 */
export function installReplaySite(session: Session, input: {
  store: WebRecordingStore
  origin: string
  resources: WebRecordingResources
  external: readonly ExternalResource[]
  onMissing: (url: string, reason: string) => void
}): ReplaySiteLoads {
  const resources = new Map<string, WebRecordingResources['entries'][number]>()
  for (const entry of input.resources.entries) { resources.set(withoutHash(entry.url), entry); resources.set(normalizeUrl(entry.url), entry) }
  const external = new Map(input.external.map(r => [withoutHash(r.url), r]))

  const serve = async (request: Request): Promise<Response> => {
    const url = withoutHash(request.url)
    const parsed = new URL(url)
    if (parsed.origin === input.origin) {
      if (parsed.pathname === BOOTSTRAP_PATH) return new Response(BOOTSTRAP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      const entry = resources.get(url) ?? resources.get(normalizeUrl(url)) ?? (parsed.pathname === '/' ? resources.get(`${input.origin}/index.html`) : undefined)
      if (!entry) { input.onMissing(url, '录制里没有这个前端文件'); return new Response(null, { status: 404 }) }
      return new Response(new Uint8Array(await input.store.readBlob(entry.blob)), { status: entry.status || 200, headers: entry.contentType ? { 'content-type': entry.contentType } : {} })
    }
    const recorded = external.get(url)
    if (!recorded) { input.onMissing(url, '录制里没有这个外部资源'); return new Response(null, { status: 404 }) }
    // The WebView's outcome wins: a favicon that failed while recording fails again.
    if (recorded.outcome === 'error') return new Response(null, { status: 404 })
    if (!recorded.fetched?.ok) { input.onMissing(url, '录制时未能补抓这个外部资源'); return new Response(null, { status: 404 }) }
    return new Response(new Uint8Array(await input.store.readBlob(recorded.fetched.blob)), { status: 200, headers: { 'content-type': recorded.fetched.contentType, 'access-control-allow-origin': '*' } })
  }
  let inFlight = 0
  let waiters: Array<() => void> = []
  const counted = async (request: Request): Promise<Response> => {
    inFlight += 1
    try { return await serve(request) } finally {
      inFlight -= 1
      if (inFlight === 0) { const wake = waiters; waiters = []; wake.forEach(resolve => resolve()) }
    }
  }
  session.protocol.handle('http', counted)
  session.protocol.handle('https', counted)
  return {
    inFlight: () => inFlight,
    idle: () => (inFlight === 0 ? Promise.resolve() : new Promise<void>(resolve => { waiters.push(resolve) })),
  }
}
