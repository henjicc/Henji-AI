import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { readWebAppRecordingCapability, renderWebAppReplayCapability, startWebAppRecordingCapability, stopWebAppRecordingCapability } from '@/core/application-control/domains/screenRecording/webAppCapability'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { getPlatform } from '@/platform'
import { WEB_APP_RECORDING_DISABLED_MESSAGE, webAppRecordingEnabled } from '../useWebAppRecordingSwitch'

const APP = 'screen_recording.web_app'
const RECORDING = 'screen_recording.web_recording'
type WebType = typeof APP | typeof RECORDING
const appReason = '连接状态由被录应用里的痕迹探针维护；开始录制用 start_web_app_recording。'
const recordingReason = '录制文件录完即锁定，只能读取和重演；停止用 stop_web_app_recording，重演出视频用 render_web_app_replay。'

function schemaRef(kind: 'entity' | 'property', id: string) {
  const seed = [...id].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${seed.padEnd(64, seed).slice(0, 64)}` } as const
}
const detailsSchema = z.object({
  app: z.string(), version: z.string(), host: z.string(), url: z.string(), width: z.number(), height: z.number(), dpr: z.number(),
  recordingId: z.string().nullable().optional(), durationMs: z.number().optional(), warnings: z.array(z.string()).optional(), createdAt: z.string().optional(),
}).strict()

function properties(type: WebType): ApplicationPropertyDescriptor[] {
  const readOnlyReason = type === APP ? appReason : recordingReason
  return ([['name', '名称', { kind: 'string' }], ['phase', '状态', { kind: 'string' }], ['details', '应用与录制信息', { kind: 'json', schemaRef: schemaRef('property', `${type}.details.value`) }]] as const).map(([suffix, title, value]) => ({
    id: `${type}.${suffix}`, entityType: type, version: 1, title, description: title, value: value as ApplicationPropertyDescriptor['value'], nullable: false, dataClass: 'C1' as const,
    exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['screen_recording:read'], write: [] }, revisionScopes: ['screen_recording'],
    schemaRef: schemaRef('property', `${type}.${suffix}`), readOnlyReason,
  }))
}

async function valuesOf(type: WebType, id: string): Promise<Record<string, JsonValue>> {
  const platform = getPlatform().webReplay
  if (type === APP) {
    const app = (await platform.apps()).apps.find(item => item.connectionId === id)
    if (!app) throw new Error('这个网页应用已断开，请重新列出 screen_recording.web_app')
    return { name: app.app.name, phase: app.recordingId ? 'recording' : 'connected', details: { app: app.app.name, version: app.app.version, host: app.host, url: app.env.url, width: app.env.viewport.width, height: app.env.viewport.height, dpr: app.env.viewport.dpr, recordingId: app.recordingId } }
  }
  const recording = (await platform.recordings()).find(item => item.id === id)
  if (!recording) throw new Error('没有找到这段网页录制，请重新列出 screen_recording.web_recording')
  return { name: `${recording.app.name} ${recording.createdAt.slice(0, 19).replace('T', ' ')}`, phase: recording.status, details: {
    app: recording.app.name, version: recording.app.version, host: recording.host, url: recording.env.url, width: recording.env.viewport.width, height: recording.env.viewport.height, dpr: recording.env.viewport.dpr,
    durationMs: Math.round(recording.durationUs / 1000), warnings: recording.warnings.map(w => w.message), createdAt: recording.createdAt,
  } }
}

class WebAppProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: WebType) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
    const platform = getPlatform().webReplay
    const items = this.entityType === APP
      ? (await platform.apps()).apps.map(a => ({ id: a.connectionId, label: `${a.app.name}${a.recordingId ? '（录制中）' : ''}` }))
      : (await platform.recordings()).map(r => ({ id: r.id, label: `${r.app.name} ${r.createdAt.slice(0, 19).replace('T', ' ')}` }))
    return { refs: items.slice(offset, offset + request.limit).map(item => ({ kind: this.entityType, id: item.id, label: item.label })), nextCursor: offset + request.limit < items.length ? String(offset + request.limit) : null, revisions: { screen_recording: 0 } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const values = await valuesOf(this.entityType, ref.id)
    const props = Object.fromEntries(Object.entries(values).map(([key, value]) => [`${this.entityType}.${key}`, value]).filter(([key]) => !request.propertyIds || request.propertyIds.includes(key as string)))
    return { ref, entityType: this.entityType, revisions: { screen_recording: 0 }, capturedAt: new Date().toISOString(), properties: props }
  }
  async getPropertyAvailability(ref: ApplicationRef, ids: string[]) {
    await this.readEntity(ref, {})
    return ids.map(propertyId => {
      if (!properties(this.entityType).some(p => p.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: [this.entityType === APP ? appReason : recordingReason], requiredPermissions: ['screen_recording:read'], revisions: { screen_recording: 0 } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { return unrestrictedCollectionAvailability(this.entityType, parent, { screen_recording: 0 }, []) }
}

export function webAppRecordingRegistrations(): ApplicationEntityRegistration[] {
  return ([APP, RECORDING] as const).map(type => ({
    entity: { id: type, domain: 'screen_recording', version: 1, title: type === APP ? '已接入的网页应用' : '网页应用录制', description: type === APP ? appReason : recordingReason, refKind: type, dataClass: 'C1' as const,
      exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['screen_recording'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', type),
      writeExclusion: { reason: type === APP ? appReason : recordingReason } },
    properties: properties(type), provider: new WebAppProvider(type), schemaDocuments: [{ ref: schemaRef('property', `${type}.details.value`), value: z.toJSONSchema(detailsSchema) as JsonValue }],
  })) as ApplicationEntityRegistration[]
}

export const WEB_APP_CAPABILITY_IDS = new Set<string>([startWebAppRecordingCapability.id, stopWebAppRecordingCapability.id, readWebAppRecordingCapability.id, renderWebAppReplayCapability.id])

/** Handlers for the web app recording capabilities; all real work happens in the main-process service. */
export async function executeWebAppCapability(id: string, input: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const platform = getPlatform().webReplay
  const permissions = context.callerGrant?.permissions
  // Reading saved recordings stays available; recording and replay need the experimental switch.
  if (id !== readWebAppRecordingCapability.id && !webAppRecordingEnabled()) throw new Error(WEB_APP_RECORDING_DISABLED_MESSAGE)
  if (id === startWebAppRecordingCapability.id) {
    const parsed = startWebAppRecordingCapability.inputSchema.parse(input)
    const manifest = await platform.start(parsed.appRef.id)
    return { resultRef: { kind: RECORDING, id: manifest.id }, verified: (await platform.recordings()).some(r => r.id === manifest.id) }
  }
  if (id === stopWebAppRecordingCapability.id) {
    const parsed = stopWebAppRecordingCapability.inputSchema.parse(input)
    const manifest = await platform.stop(parsed.recordingRef.id)
    const status = manifest.status === 'complete' ? 'complete' : 'interrupted'
    return { resultRef: parsed.recordingRef, status, durationMs: Math.round(manifest.durationUs / 1000), warnings: manifest.warnings.map(w => w.message), verified: (await platform.recordings()).find(r => r.id === manifest.id)?.status === status }
  }
  if (id === readWebAppRecordingCapability.id) {
    if (permissions && !permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:读取网页录制需要 screen_recording:read 权限')
    const parsed = readWebAppRecordingCapability.inputSchema.parse(input)
    return { ...await platform.read({ recordingId: parsed.recordingRef.id, track: parsed.track, offset: parsed.offset, limit: parsed.limit }) }
  }
  const parsed = renderWebAppReplayCapability.inputSchema.parse(input)
  context.signal.throwIfAborted()
  const result = await platform.render({ recordingId: parsed.recordingRef.id, fps: parsed.fps })
  return {
    resultRef: parsed.recordingRef, video: result.output, width: result.width, height: result.height, frames: result.frames,
    conflicts: result.issues.filter(i => i.kind === 'conflict').map(i => i.message), warnings: result.issues.filter(i => i.kind === 'warning').map(i => i.message), verified: result.frames > 0,
  }
}
