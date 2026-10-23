/**
 * Wire contract between the probe (inside the recorded app) and Henji.
 * Times are integer microseconds since the recording page's `performance.now() === 0`
 * unless a field says otherwise. Henji validates every message with its own zod schemas.
 */

export const PROBE_PROTOCOL_VERSION = 1
export const PROBE_VERSION = '0.1.0'
export const DEFAULT_HENJI_PORT = 47831
export const PROBE_WS_PATH = '/web-replay'

export type HostKind = 'tauri' | 'electron' | 'web'
export interface AppInfo { name: string; version: string }
export interface Viewport { width: number; height: number; dpr: number }
export interface ProbeEnvironment {
  url: string
  viewport: Viewport
  colorScheme: 'light' | 'dark'
  reducedMotion: boolean
  locale: string
  timeZone: string
  userAgent: string
}

/** Text when it is valid UTF-8, otherwise base64. Henji stores large or binary bodies as blobs. */
export type WireBody = { text: string } | { base64: string }
export type HeaderList = Array<[string, string]>

/** Structured-clone value encoded as JSON (see shared/codec.ts). */
export type Encoded = unknown

export type Modifiers = number // bit flags: 1 alt, 2 ctrl, 4 meta, 8 shift (same as CDP)

export interface Locator {
  /** Closest `[data-replay-id]` (or the attribute the app registered). */
  replayId?: string
  /** Closest action attribute (default `data-act`) with the nearest ancestor that has an id. */
  act?: { name: string; anchor?: string }
  role?: string
  name?: string
  tag: string
  /** CSS child path from <body>, used only as a fallback. */
  path: string
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface ElementInfo { locator: Locator; rect: Rect; /** Point inside rect, 0..1 on each axis. */ offset: [number, number] }

// ---------------------------------------------------------------- data track events

export type BoundaryKind = 'xhr' | 'websocket' | 'eventsource' | 'worker' | 'plugin-http' | 'other'

export type DataEvent =
  | { kind: 'http.request'; id: number; t: number; via: 'seam' | 'fetch'; method: string; url: string; headers: HeaderList; body?: WireBody }
  | { kind: 'http.response'; id: number; t: number; status: number; statusText: string; url: string; headers: HeaderList }
  | { kind: 'http.chunk'; id: number; t: number; body: WireBody }
  | { kind: 'http.end'; id: number; t: number }
  | { kind: 'http.error'; id: number; t: number; phase: 'request' | 'body'; name: string; message: string }
  | { kind: 'host.call'; id: number; t: number; command: string; args: Encoded }
  | { kind: 'host.result'; id: number; t: number; ok: true; value: Encoded }
  | { kind: 'host.result'; id: number; t: number; ok: false; error: Encoded }
  /**
   * A host → page callback (Tauri `transformCallback`). `call` is the host call whose arguments
   * carried the callback (event listen handler, channel); replay maps it through the matched call.
   * `index` is the callback's position among those referenced by that call.
   */
  | { kind: 'host.callback'; t: number; call: number | null; index: number; payload: Encoded }
  | { kind: 'external'; t: number; url: string; initiator: string; outcome?: 'load' | 'error'; width?: number; height?: number }
  | { kind: 'random'; t: number; source: 'math'; values: number[] }
  | { kind: 'random'; t: number; source: 'uuid'; values: string[] }
  | { kind: 'random'; t: number; source: 'bytes'; values: string[] /* base64 */ }
  | { kind: 'clipboard.read'; t: number; text: string }
  | { kind: 'boundary'; t: number; boundary: BoundaryKind; detail: string }

// ---------------------------------------------------------------- behavior track events

export interface WireFile { name: string; type: string; lastModified: number; body: WireBody }
export type PointerKind = 'move' | 'down' | 'up'

export type BehaviorEvent =
  | { kind: 'pointer'; t: number; type: PointerKind; x: number; y: number; button: number; buttons: number; clickCount: number; pointerType: string; mods: Modifiers; target?: ElementInfo }
  | { kind: 'wheel'; t: number; x: number; y: number; dx: number; dy: number; mods: Modifiers; target?: ElementInfo }
  | { kind: 'key'; t: number; type: 'down' | 'up'; key: string; code: string; keyCode: number; location: number; repeat: boolean; mods: Modifiers; composing: boolean; target?: ElementInfo }
  /** Committed text from an input method (compositionend). Plain key typing stays as key events. */
  | { kind: 'text'; t: number; data: string; target?: ElementInfo }
  | { kind: 'paste'; t: number; text?: string; html?: string; files: WireFile[]; target?: ElementInfo }
  | { kind: 'drop'; t: number; x: number; y: number; text?: string; files: WireFile[]; target?: ElementInfo }
  | { kind: 'resize'; t: number; width: number; height: number; dpr: number }
  | { kind: 'focus'; t: number; focused: boolean }
  | { kind: 'action'; t: number; name: string; detail?: Encoded }

export type ProbeEvent = (DataEvent | BehaviorEvent) & { seq: number }

// ---------------------------------------------------------------- storage

export interface IdbIndexDump { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }
export interface IdbStoreDump { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: IdbIndexDump[]; records: Array<{ key: Encoded; value: Encoded }> }
export interface IdbDatabaseDump { name: string; version: number; stores: IdbStoreDump[] }
export interface StorageSnapshot { local: Array<[string, string]>; session: Array<[string, string]>; indexedDB: IdbDatabaseDump[] }

// ---------------------------------------------------------------- messages

export type ProbeMessage =
  | { type: 'hello'; protocol: number; probeVersion: string; app: AppInfo; host: HostKind; env: ProbeEnvironment; session?: string }
  | { type: 'pong'; id: number; now: number /* performance.now() ms */ }
  | { type: 'started'; session: string; wallAtZeroMs: number; env: ProbeEnvironment }
  | { type: 'storage'; session: string; snapshot: StorageSnapshot }
  | { type: 'events'; session: string; events: ProbeEvent[] }
  | { type: 'resource'; session: string; url: string; status: number; contentType: string; body: WireBody }
  | { type: 'stopped'; session: string; resources: number; fonts: string[] }
  | { type: 'error'; session?: string; message: string }

export type HenjiMessage =
  | { type: 'welcome'; connection: string }
  | { type: 'ping'; id: number }
  | { type: 'start'; session: string }
  | { type: 'stop'; session: string }
