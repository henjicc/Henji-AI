import type { ElementInfo, Encoded, HeaderList, HostKind, Locator, ProbeEnvironment, WireBody } from '../protocol'
import type { LocatorOptions } from '../shared/locatorOptions'
/**
 * A place in the page the replay engine was told to act on (a director script's target): an element found by CSS
 * selector and/or visible text, or a viewport point. Only elements with a box count; `index` picks among the matches
 * in document order, `offset` the point inside the element (fractions of its width and height, centre by default).
 */
export interface ReplayTarget {
  selector?: string
  text?: string
  index?: number
  offset?: [number, number]
  x?: number
  y?: number
}

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

/** `t`: page time of the call (µs), to compare with the recorded call time. */
export interface ReplayHttpRequest { method: string; url: string; headers: HeaderList; body?: WireBody; via: 'seam' | 'fetch'; t?: number }
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

/**
 * `pageOffsetUs`: page time minus recording time at the call (a director script's typing moved page time ahead of
 * the recording); the call's recorded host callbacks, timed on the recording, land that much later. Omitted means 0.
 */
export type ReplayHostResult =
  | { ok: true; call: number; resolved: true; value: Encoded; at: number; pageOffsetUs?: number }
  | { ok: true; call: number; resolved: false; error: Encoded; at: number; pageOffsetUs?: number }
  | { ok: false; conflict: string }

export type ReplayReport =
  | { kind: 'ready'; now: number }
  | { kind: 'failed'; message: string }
  | { kind: 'conflict'; t: number; message: string }
  | { kind: 'warning'; t: number; message: string }
  | { kind: 'action'; t: number; name: string }

/** Implemented by the Henji preload; the runtime never talks to Electron directly. */
export interface ReplayHost {
  boot: ReplayBoot
  http(request: ReplayHttpRequest): Promise<ReplayHttpResult>
  invoke(command: string, args: Encoded, t?: number): Promise<ReplayHostResult>
  report(report: ReplayReport): void
}

export const REPLAY_GLOBAL = '__HENJI_WEB_REPLAY__'
export const REPLAY_CONTROL = '__HENJI_WEB_REPLAY_CONTROL__'

/** Page-side report of one rendered frame. */
export interface ReplayFrameReport {
  /** Page time the frame shows (ms). */
  now: number
  timers: number
  frameCallbacks: number
  animations: number
  /** Not rendered: nothing could have changed the picture since the last rendered frame. */
  quiet: boolean
  samples: Record<string, { ok: true; value: unknown } | { ok: false; error: string }>
}

/** What the engine calls on the replay page (through executeJavaScript on `window[REPLAY_CONTROL]`). */
export interface ReplayControl {
  locate(locator: Locator, offset: [number, number]): { x: number; y: number } | null
  pointFor(target: ElementInfo): { x: number; y: number } | null
  /** Page time (ms). */
  now(): number
  /** Runs the page's timers up to `toMs` without rendering; page time then rests there. */
  advance(toMs: number): Promise<{ now: number; timers: number; nextDue: number }>
  /** Resolves after the next real rendering update (input the browser holds for the frame is delivered). */
  realFrame(): Promise<void>
  /** 固定页面节拍的逻辑帧：推进动画与帧回调，不等待绘制、不采样。 */
  tick(toMs: number): Promise<ReplayFrameReport>
  /**
   * Renders the page at `toMs`: timers, animations and animation-frame callbacks, the capture token
   * `token` (if given) in that same frame, then the named samplers read that state.
   */
  frame(toMs: number, options?: { token?: number; samples?: string[]; allowQuiet?: boolean; tick?: boolean }): Promise<ReplayFrameReport>
  defineSampler(name: string, read: () => unknown): void
  viewport(): { width: number; height: number }
  /** Repaints the current capture token (same token) so a dropped capture comes again. */
  repaintToken(): Promise<void>
  /** Where a director script's target is right now (viewport CSS px), or null when it is not in the page. */
  resolveTarget(target: ReplayTarget): { x: number; y: number } | null
}

/**
 * The capture token: a CSS-pixel square in the page's top-left corner, painted in one of these colours
 * (RGB) in the same frame as the state it marks. The engine reads it from the captured picture to know
 * the picture shows that frame (not an earlier one), then paints the square over from its neighbours.
 */
export const CAPTURE_TOKEN_COLORS: ReadonlyArray<readonly [number, number, number]> = [[255, 0, 255], [0, 255, 255], [255, 255, 0], [0, 0, 255]]
export const CAPTURE_TOKEN_CSS_PX = 2

/** Tile size (device pixels) the frame reader compares and copies back. */
export const READER_TILE = 64

/**
 * The engine asks the frame reader window to check one captured frame (a shared texture): does it show
 * capture token `token` (null: take it whatever it shows)? If so, which tiles changed since the last
 * accepted frame (`full`: send every tile), copied back; the frame becomes the accepted one. `guard`: the
 * token square's size, never counted as a change.
 */
export interface ReaderRequest { id: number; token: number | null; full: boolean; guard: number }
/**
 * `token`: the capture token the frame shows (-1 none). `tiles`: indices (row-major, READER_TILE square)
 * of the tiles in `pixels`, one after another, each as NV12 (BT.601 limited range): READER_TILE rows of
 * READER_TILE luma bytes, then READER_TILE / 2 rows of READER_TILE interleaved U, V bytes; null when the
 * frame was not accepted (an earlier picture).
 */
export type ReaderResult =
  | { id: number; ok: true; token: number; width: number; height: number; tiles: Uint32Array | null; pixels: Uint8Array | null }
  | { id: number; ok: false; error: string }
