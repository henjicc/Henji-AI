import { fieldWriterTable, type ApplicationFieldDefinition } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { WebRecordingSummary } from '@/platform/contracts/webReplay'
import { WEB_RECORDING_TYPE } from './webAppRecordingCollectionExecutor'

export function webAppSchemaRef(kind: 'entity' | 'property', id: string) {
  const seed = [...id].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${seed.padEnd(64, seed).slice(0, 64)}` } as const
}

export const WEB_RECORDING_NAME = `${WEB_RECORDING_TYPE}.name`
export function webRecordingDisplayName(recording: Pick<WebRecordingSummary, 'title' | 'app' | 'createdAt'>): string {
  return recording.title ?? `${recording.app.name} ${recording.createdAt.slice(0, 19).replace('T', ' ')}`
}

/** A web recording's name is the one thing that can change after recording; the page's rename uses the same service. */
export const webRecordingFields: ApplicationFieldDefinition<WebRecordingSummary, { title?: string }>[] = [{
  propertyId: WEB_RECORDING_NAME, storeActions: [],
  descriptor: {
    id: WEB_RECORDING_NAME, entityType: WEB_RECORDING_TYPE, version: 1, title: '名称', description: '录制名称；没起名时为应用名加录制时间。改名可撤销。',
    value: { kind: 'string' }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['screen_recording:read'], write: ['screen_recording:write'] }, revisionScopes: ['screen_recording'], schemaRef: webAppSchemaRef('property', WEB_RECORDING_NAME),
  },
  read: recording => webRecordingDisplayName(recording),
  writer: { write: (draft, mutation) => {
    const value = typeof mutation.value === 'string' ? mutation.value.trim() : ''
    if (!value || value.length > 120) throw new Error('网页录制名称需为 1–120 个字符。')
    draft.title = value
  } },
}]
export const webRecordingWriterTable = fieldWriterTable(webRecordingFields)
