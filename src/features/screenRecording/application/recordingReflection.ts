import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { getPlatform } from '@/platform'
import { recordingDevices } from '../tracks/devices'
import { recordingDocumentSchema } from '@/core/screenRecording/document'
import { recordingTrackOptionsSchema } from '@/core/screenRecording/tracks'

const types = ['screen_recording.session', 'screen_recording.source', 'screen_recording.device'] as const
const reason = '采集事实由统一录制服务维护；开始、暂停、恢复、标记、停止和恢复使用录制语义操作，文档改名与删除走 documents.document。'
function schemaRef(kind: 'entity' | 'property', id: string) {
  const seed = [...id].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${seed.padEnd(64, seed).slice(0, 64)}` } as const
}
const detailsSchema = z.object({
  source: z.string().optional(), cursorEmbedded: z.boolean().optional(),
  media: z.array(z.object({ id: z.string(), kind: z.string(), monoUs: z.number(), durationUs: z.number() }).strict()).optional(),
  markers: z.number().int().nonnegative().optional(), events: z.number().int().nonnegative().optional(),
  deviceKind: z.string().optional(), sourceKind: z.string().optional(),
  devices: recordingTrackOptionsSchema.optional(), deviceId: z.string().optional(),
}).strict()
function properties(type: string): ApplicationPropertyDescriptor[] {
  return [
    ['name', '名称', { kind: 'string' }], ['phase', '录制状态', { kind: 'string' }], ['elapsed_ms', '已录制毫秒', { kind: 'number' }],
    ['details', '轨道与事件摘要', { kind: 'json', schemaRef: schemaRef('property', `${type}.details.value`) }],
  ].map(([suffix, title, value]) => ({ id: `${type}.${suffix}`, entityType: type, version: 1, title: title as string, description: title as string,
    value: value as ApplicationPropertyDescriptor['value'], nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['screen_recording:read'], write: [] },
    revisionScopes: ['screen_recording'], schemaRef: schemaRef('property', `${type}.${suffix}`), readOnlyReason: reason }))
}
class RecordingProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: typeof types[number]) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
    const items = this.entityType === 'screen_recording.session' ? (await getPlatform().documents.listDocuments({ kind: 'screen_recording', includeMissing: false })).map(item => ({ id: item.id, name: item.name }))
      : this.entityType === 'screen_recording.source' ? await getPlatform().screenRecording.sources()
        : (await recordingDevices()).filter(item => item.id).map(item => ({ id: `${item.kind}:${item.id}`, name: item.label || item.kind }))
    return { refs: items.slice(offset, offset + request.limit).map(item => ({ kind: this.entityType, id: item.id, label: item.name })), nextCursor: offset + request.limit < items.length ? String(offset + request.limit) : null, revisions: { screen_recording: 0 } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    let values: Record<string, JsonValue>
    let revision = 0
    if (this.entityType === 'screen_recording.session') {
      const read = await getPlatform().documents.readDocument({ id: ref.id })
      if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
      const content = recordingDocumentSchema.parse(read.content), meta = read.meta
      const snapshot = await getPlatform().screenRecording.snapshot()
      const active = snapshot?.sessionId === content.sessionId ? snapshot : null
      revision = meta.revision
      values = { name: meta.name, phase: active?.phase ?? content.status, elapsed_ms: active?.elapsedMs ?? Math.max(0, ...content.media.map(media => media.monoUs + media.durationUs)), details: {
        source: content.source?.name ?? '', cursorEmbedded: content.source?.cursorEmbedded ?? false, media: content.media.map(({ path: _path, ...media }) => media), markers: content.markers.length,
        events: content.eventPages.reduce((sum, page) => sum + page.lastSequence - page.firstSequence + 1, 0),
        devices: content.devices,
      } }
      if (!active) values.elapsed_ms = Math.round(Number(values.elapsed_ms) / 1000)
    } else {
      const source = this.entityType === 'screen_recording.source' ? (await getPlatform().screenRecording.sources()).find(item => item.id === ref.id) : undefined
      const device = this.entityType === 'screen_recording.device' ? (await recordingDevices()).find(item => `${item.kind}:${item.id}` === ref.id) : undefined
      if (!source && !device) throw new Error('来源或设备已移除，请重新列出')
      values = { name: source?.name ?? device?.label ?? '', phase: 'available', elapsed_ms: 0, details: source ? { sourceKind: source.kind } : { deviceKind: device!.kind, deviceId: device!.id } }
    }
    return { ref, entityType: this.entityType, revisions: { screen_recording: revision }, capturedAt: new Date().toISOString(), properties: Object.fromEntries(Object.entries(values).map(([key, value]) => [`${this.entityType}.${key}`, value]).filter(([key]) => !request.propertyIds || request.propertyIds.includes(String(key)))) }
  }
  async getPropertyAvailability(ref: ApplicationRef, ids: string[]) {
    const snapshot = await this.readEntity(ref, {})
    return ids.map(propertyId => {
      if (!properties(this.entityType).some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['screen_recording:read'], revisions: snapshot.revisions }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { return unrestrictedCollectionAvailability(this.entityType, parent, { screen_recording: 0 }, []) }
}
export function recordingRegistrations(): ApplicationEntityRegistration[] {
  return types.map(type => ({ entity: { id: type, domain: 'screen_recording', version: 1, title: { 'screen_recording.session': '录制会话', 'screen_recording.source': '可录制来源', 'screen_recording.device': '录制设备' }[type],
    description: reason, refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['screen_recording'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', type), writeExclusion: { reason } },
    properties: properties(type), provider: new RecordingProvider(type), schemaDocuments: [{ ref: schemaRef('property', `${type}.details.value`), value: z.toJSONSchema(detailsSchema) as JsonValue }],
  }))
}
