import { DEFAULT_HENJI_PORT, type AppInfo } from './protocol'
import { DEFAULT_LOCATOR_OPTIONS, type LocatorOptions } from './shared/locator'
import { Recorder } from './record/recorder'
import type { FetchLike } from './record/networkTap'
import { REPLAY_GLOBAL } from './replay/types'

export type { AppInfo } from './protocol'
export type { LocatorOptions } from './shared/locator'

export interface ProbeConfig {
  app: AppInfo
  /** Henji's local port. Default 47831. */
  port?: number
  /** Set false to compile the probe in but never connect. */
  enabled?: boolean
  locator?: Partial<LocatorOptions>
}

interface ReplayGlobal { fetch: FetchLike; action: (name: string, detail?: unknown) => void }

let recorder: Recorder | null = null

function replay(): ReplayGlobal | undefined {
  return (globalThis as unknown as Record<string, ReplayGlobal | undefined>)[REPLAY_GLOBAL]
}

/**
 * Call from the app's first module (a side-effect import placed before every other import).
 * Outside a Henji session it only keeps a quiet connection attempt to Henji on 127.0.0.1.
 */
export function initProbe(config: ProbeConfig): void {
  if (recorder || replay() || config.enabled === false || typeof window === 'undefined') return
  recorder = new Recorder({
    app: config.app,
    port: config.port ?? DEFAULT_HENJI_PORT,
    locator: { ...DEFAULT_LOCATOR_OPTIONS, ...config.locator, actionAttributes: config.locator?.actionAttributes ?? DEFAULT_LOCATOR_OPTIONS.actionAttributes },
  })
}

/**
 * Wrap the app's single network exit. Recording copies requests and streamed responses;
 * replay answers from the recording without calling `inner`; otherwise it is `inner` unchanged.
 */
export function wrapFetch<A extends [input: unknown, init?: unknown], R extends Promise<Response>>(inner: (...args: A) => R): (...args: A) => R {
  const call = inner as unknown as FetchLike
  return ((...args: A) => {
    const [input, init] = args as unknown as [RequestInfo | URL, RequestInit | undefined]
    const r = replay()
    if (r) return r.fetch(input, init)
    return recorder ? recorder.fetch(call, input, init) : call(input, init)
  }) as unknown as (...args: A) => R
}

/** Optional semantic marker, e.g. reportAction('ask', { question }). */
export function reportAction(name: string, detail?: unknown): void {
  const r = replay()
  if (r) r.action(name, detail)
  else recorder?.action(name, detail)
}

/** True while Henji is recording or replaying this page. */
export function isUnderHenji(): boolean {
  return Boolean(replay() || recorder?.recording)
}
