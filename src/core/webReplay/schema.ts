import { foreignContentSchema } from '../contentTrust'
import { z } from 'zod'

/**
 * Web app recording: wire messages from the probe and the files of a recording directory.
 * The probe package (packages/web-replay-probe/src/protocol.ts) owns the TypeScript wire types;
 * these schemas validate them at Henji's boundary and are checked against them in tests.
 */

/** v2: element locators may name the enclosing data-replay-id container (`act.scope`). */
export const WEB_RECORDING_VERSION = 4
export const WEB_RECORDING_MIN_READER_VERSION = 1
/** Manifest N → N+1. Shared by the file format and the `.hjweb` document kind, which reads the same manifest. */
export const WEB_RECORDING_MIGRATIONS: Readonly<Record<number, (value: unknown) => unknown>> = {
  // v2（2026-10-23）：元素定位只新增可选的 act.scope。
  1: value => ({ ...value as object, version: 2 }),
  // v3（2026-10-23）：只新增可选的 title。
  2: value => ({ ...value as object, version: 3 }),
  // v4：仅导入的录制添加外来标记，历史录制保持本机身份。
  3: value => ({ ...value as object, version: 4 }),
}

const us = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const finite = z.number().finite()
const id = z.number().int().nonnegative()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const encoded = z.unknown()
export const headerListSchema = z.array(z.tuple([z.string(), z.string()]))
export const wireBodySchema = z.union([z.object({ text: z.string() }).strict(), z.object({ base64: z.string() }).strict()])
export type WireBodyValue = z.infer<typeof wireBodySchema>
/** Stored bodies keep text inline; bytes that are not UTF-8 live in blobs/<sha256>. */
export const storedBodySchema = z.union([z.object({ text: z.string() }).strict(), z.object({ blob: digest, size: us }).strict()])
export type StoredBody = z.infer<typeof storedBodySchema>

export const appInfoSchema = z.object({ name: z.string().min(1).max(200), version: z.string().max(100) }).strict()
export type AppInfoValue = z.infer<typeof appInfoSchema>
export const hostKindSchema = z.enum(['tauri', 'electron', 'web'])
export const viewportSchema = z.object({ width: finite.positive(), height: finite.positive(), dpr: finite.positive() }).strict()
export const environmentSchema = z.object({
  url: z.string().url(), viewport: viewportSchema, colorScheme: z.enum(['light', 'dark']), reducedMotion: z.boolean(),
  locale: z.string(), timeZone: z.string(), userAgent: z.string(),
}).strict()
export type WebRecordingEnvironment = z.infer<typeof environmentSchema>

const rectSchema = z.object({ x: finite, y: finite, width: finite, height: finite }).strict()
export const locatorSchema = z.object({
  replayId: z.string().optional(), act: z.object({ name: z.string(), anchor: z.string().optional(), scope: z.string().optional() }).strict().optional(),
  role: z.string().optional(), name: z.string().optional(), tag: z.string(), path: z.string(),
}).strict()
export const elementInfoSchema = z.object({ locator: locatorSchema, rect: rectSchema, offset: z.tuple([finite, finite]) }).strict()
export type ElementInfoValue = z.infer<typeof elementInfoSchema>

// ---------------------------------------------------------------- probe events (wire)

const httpPhase = z.enum(['request', 'body'])
export const dataEventSchemas = [
  z.object({ kind: z.literal('http.request'), id, t: us, via: z.enum(['seam', 'fetch']), method: z.string(), url: z.string(), headers: headerListSchema, body: wireBodySchema.optional() }).strict(),
  z.object({ kind: z.literal('http.response'), id, t: us, status: z.number().int(), statusText: z.string(), url: z.string(), headers: headerListSchema }).strict(),
  z.object({ kind: z.literal('http.chunk'), id, t: us, body: wireBodySchema }).strict(),
  z.object({ kind: z.literal('http.end'), id, t: us }).strict(),
  z.object({ kind: z.literal('http.error'), id, t: us, phase: httpPhase, name: z.string(), message: z.string() }).strict(),
  z.object({ kind: z.literal('host.call'), id, t: us, command: z.string(), args: encoded }).strict(),
  z.object({ kind: z.literal('host.result'), id, t: us, ok: z.literal(true), value: encoded }).strict(),
  z.object({ kind: z.literal('host.result'), id, t: us, ok: z.literal(false), error: encoded }).strict(),
  z.object({ kind: z.literal('host.callback'), t: us, call: id.nullable(), index: id, payload: encoded }).strict(),
  z.object({ kind: z.literal('external'), t: us, url: z.string(), initiator: z.string(), outcome: z.enum(['load', 'error']).optional(), width: finite.optional(), height: finite.optional() }).strict(),
  z.object({ kind: z.literal('random'), t: us, source: z.literal('math'), values: z.array(finite) }).strict(),
  z.object({ kind: z.literal('random'), t: us, source: z.literal('uuid'), values: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('random'), t: us, source: z.literal('bytes'), values: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('clipboard.read'), t: us, text: z.string() }).strict(),
  z.object({ kind: z.literal('boundary'), t: us, boundary: z.enum(['xhr', 'websocket', 'eventsource', 'worker', 'plugin-http', 'other']), detail: z.string() }).strict(),
] as const

const mods = z.number().int().min(0).max(15)
function behaviorEventSchemas<B extends z.ZodType>(body: B) {
  const file = z.object({ name: z.string(), type: z.string(), lastModified: finite, body }).strict()
  return [
    z.object({ kind: z.literal('pointer'), t: us, type: z.enum(['move', 'down', 'up']), x: finite, y: finite, button: z.number().int(), buttons: z.number().int(), clickCount: z.number().int(), pointerType: z.string(), mods, target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('wheel'), t: us, x: finite, y: finite, dx: finite, dy: finite, mods, target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('key'), t: us, type: z.enum(['down', 'up']), key: z.string(), code: z.string(), keyCode: z.number().int(), location: z.number().int(), repeat: z.boolean(), mods, composing: z.boolean(), target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('text'), t: us, data: z.string(), target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('paste'), t: us, text: z.string().optional(), html: z.string().optional(), files: z.array(file), target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('drop'), t: us, x: finite, y: finite, text: z.string().optional(), files: z.array(file), target: elementInfoSchema.optional() }).strict(),
    z.object({ kind: z.literal('resize'), t: us, width: finite.positive(), height: finite.positive(), dpr: finite.positive() }).strict(),
    z.object({ kind: z.literal('focus'), t: us, focused: z.boolean() }).strict(),
    z.object({ kind: z.literal('action'), t: us, name: z.string().min(1).max(200), detail: encoded.optional() }).strict(),
  ] as const
}

const behaviorWireSchemas = behaviorEventSchemas(wireBodySchema)
type DataEventValue = z.infer<(typeof dataEventSchemas)[number]>
type BehaviorWireValue = z.infer<(typeof behaviorWireSchemas)[number]>
export type ProbeEventValue = (DataEventValue | BehaviorWireValue) & { seq: number }
const withSeq = (schema: z.ZodObject): z.ZodObject => schema.extend({ seq: us })
const probeEventOptions = [...dataEventSchemas, ...behaviorWireSchemas].map(withSeq)
export const probeEventSchema = z.union(probeEventOptions as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]) as unknown as z.ZodType<ProbeEventValue>

const idbIndex = z.object({ name: z.string(), keyPath: z.union([z.string(), z.array(z.string())]), unique: z.boolean(), multiEntry: z.boolean() }).strict()
const idbStore = z.object({ name: z.string(), keyPath: z.union([z.string(), z.array(z.string())]).nullable(), autoIncrement: z.boolean(), indexes: z.array(idbIndex), records: z.array(z.object({ key: encoded, value: encoded }).strict()) }).strict()
export const storageSnapshotSchema = z.object({
  local: z.array(z.tuple([z.string(), z.string()])), session: z.array(z.tuple([z.string(), z.string()])),
  indexedDB: z.array(z.object({ name: z.string(), version: z.number().int().positive(), stores: z.array(idbStore) }).strict()),
}).strict()
export type StorageSnapshotValue = z.infer<typeof storageSnapshotSchema>

const session = z.string().uuid()
export const probeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocol: z.number().int(), probeVersion: z.string(), app: appInfoSchema, host: hostKindSchema, env: environmentSchema, session: session.optional() }).strict(),
  z.object({ type: z.literal('pong'), id, now: finite }).strict(),
  z.object({ type: z.literal('started'), session, wallAtZeroMs: finite, env: environmentSchema }).strict(),
  z.object({ type: z.literal('storage'), session, snapshot: storageSnapshotSchema }).strict(),
  z.object({ type: z.literal('events'), session, events: z.array(probeEventSchema) }).strict(),
  z.object({ type: z.literal('resource'), session, url: z.string(), status: z.number().int(), contentType: z.string(), body: wireBodySchema }).strict(),
  z.object({ type: z.literal('stopped'), session, resources: z.number().int().nonnegative(), fonts: z.array(z.string()) }).strict(),
  z.object({ type: z.literal('error'), session: session.optional(), message: z.string() }).strict(),
])
export type ProbeMessageValue = z.infer<typeof probeMessageSchema>

// ---------------------------------------------------------------- stored recording

const warning = z.object({ t: us, kind: z.enum(['boundary', 'error', 'resource']), message: z.string() }).strict()
export const webRecordingManifestSchema = z.object({
  foreign: foreignContentSchema.optional(),
  version: z.number().int().positive(), minReaderVersion: z.number().int().positive(),
  id: session, status: z.enum(['recording', 'complete', 'interrupted']), createdAt: z.string().datetime(),
  /** v3: the name the user gave the recording; absent means app name plus time. */
  title: z.string().min(1).max(120).optional(),
  app: appInfoSchema, probe: z.object({ version: z.string(), protocol: z.number().int() }).strict(), host: hostKindSchema, env: environmentSchema,
  /** Date.now() at the recording page's performance.now() === 0. */
  wallAtZeroMs: finite,
  durationUs: us,
  /** Henji's monotonic clock (µs) at the recording page's zero; null when the probe never answered a ping. */
  clock: z.object({ monoAtZeroUs: finite, uncertaintyUs: us }).strict().nullable(),
  fonts: z.array(z.string()),
  warnings: z.array(warning),
}).strict()
export type WebRecordingManifest = z.infer<typeof webRecordingManifestSchema>

const httpCall = z.object({
  kind: z.literal('http'), id, t: us, via: z.enum(['seam', 'fetch']), method: z.string(), url: z.string(), headers: headerListSchema, body: storedBodySchema.optional(),
  /** Offsets below are µs after `t`. */
  response: z.object({ at: us, status: z.number().int(), statusText: z.string(), url: z.string(), headers: headerListSchema }).strict().optional(),
  chunks: z.array(z.object({ at: us, body: storedBodySchema }).strict()),
  endAt: us.optional(),
  error: z.object({ at: us, phase: httpPhase, name: z.string(), message: z.string() }).strict().optional(),
}).strict()
const hostCall = z.object({
  kind: z.literal('host'), id, t: us, command: z.string(), args: encoded,
  result: z.union([z.object({ at: us, ok: z.literal(true), value: encoded }).strict(), z.object({ at: us, ok: z.literal(false), error: encoded }).strict()]).optional(),
}).strict()
export const webRecordingCallSchema = z.discriminatedUnion('kind', [httpCall, hostCall])
export type WebRecordingCall = z.infer<typeof webRecordingCallSchema>
export type WebRecordingHttpCall = z.infer<typeof httpCall>
export type WebRecordingHostCall = z.infer<typeof hostCall>

export const externalResourceSchema = z.object({
  url: z.string(), t: us, initiator: z.string(), outcome: z.enum(['load', 'error']).optional(), width: finite.optional(), height: finite.optional(),
  /** Henji's own fetch of the URL during recording. */
  fetched: z.union([z.object({ ok: z.literal(true), status: z.number().int(), contentType: z.string(), blob: digest, size: us }).strict(), z.object({ ok: z.literal(false), message: z.string() }).strict()]).optional(),
}).strict()
export type ExternalResource = z.infer<typeof externalResourceSchema>

export const webRecordingDataSchema = z.object({
  calls: z.array(webRecordingCallSchema),
  callbacks: z.array(z.object({ t: us, call: id, index: id, payload: encoded }).strict()),
  external: z.array(externalResourceSchema),
  random: z.object({ math: z.array(finite), uuid: z.array(z.string()), bytes: z.array(z.string()) }).strict(),
  clipboard: z.array(z.object({ t: us, text: z.string() }).strict()),
}).strict()
export type WebRecordingData = z.infer<typeof webRecordingDataSchema>

export const webRecordingBehaviorEventSchema = z.discriminatedUnion('kind', behaviorEventSchemas(storedBodySchema))
export type WebRecordingBehaviorEvent = z.infer<typeof webRecordingBehaviorEventSchema>
export const webRecordingBehaviorSchema = z.object({ events: z.array(webRecordingBehaviorEventSchema) }).strict()

export const webRecordingResourcesSchema = z.object({
  entries: z.array(z.object({ url: z.string(), status: z.number().int(), contentType: z.string(), blob: digest, size: us }).strict()),
}).strict()
export type WebRecordingResources = z.infer<typeof webRecordingResourcesSchema>

export const WEB_RECORDING_FILES = { manifest: 'recording.json', data: 'data.json', behavior: 'behavior.json', storage: 'storage.json', resources: 'resources.json', journal: 'events.jsonl', blobs: 'blobs' } as const
