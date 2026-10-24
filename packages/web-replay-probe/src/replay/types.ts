import type { Encoded, HeaderList, HostKind, ProbeEnvironment, WireBody } from '../protocol'
import type { LocatorOptions } from '../shared/locatorOptions'

/** Everything the page needs synchronously before its first script runs. */
export interface ReplayBoot {
  host: HostKind
  env: ProbeEnvironment
  wallAtZeroMs: number
  random: { math: number[]; uuid: string[]; bytes: string[] }
  clipboard: string[]
  /** Recorded host → page callbacks, keyed by the recorded call that carried them. */
  callbacks: Array<{ call: number; index: number; t: number; payload: Encoded }>
  locator: LocatorOptions
  /** false: draw no pointer inside the page (a clean picture for editing; the editor redraws the pointer). Omitted means drawn. */
  pointer?: boolean
}

export interface ReplayHttpRequest { method: string; url: string; headers: HeaderList; body?: WireBody; via: 'seam' | 'fetch' }
export type ReplayHttpResult =
  | {
    ok: true
    status: number; statusText: string; url: string; headers: HeaderList
    /** Offsets are µs after the request was issued, already retimed by the engine. */
    responseAt: number
    chunks: Array<{ at: number; body: WireBody }>
    endAt?: number
    error?: { at: number; phase: 'request' | 'body'; name: string; message: string }
  }
  | { ok: false; conflict: string }

export type ReplayHostResult =
  | { ok: true; call: number; resolved: true; value: Encoded; at: number }
  | { ok: true; call: number; resolved: false; error: Encoded; at: number }
  | { ok: false; conflict: string }

export type ReplayReport =
  | { kind: 'ready'; now: number }
  | { kind: 'conflict'; t: number; message: string }
  | { kind: 'warning'; t: number; message: string }
  | { kind: 'action'; t: number; name: string }

/** Implemented by the Henji preload; the runtime never talks to Electron directly. */
export interface ReplayHost {
  boot: ReplayBoot
  http(request: ReplayHttpRequest): Promise<ReplayHttpResult>
  invoke(command: string, args: Encoded): Promise<ReplayHostResult>
  report(report: ReplayReport): void
}

export const REPLAY_GLOBAL = '__HENJI_WEB_REPLAY__'
export const REPLAY_CONTROL = '__HENJI_WEB_REPLAY_CONTROL__'
