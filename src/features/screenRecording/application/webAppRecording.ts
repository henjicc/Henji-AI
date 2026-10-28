import { z } from 'zod'
import { fieldDescriptors, unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { cancelWebAppReplayCapability, importWebRecordingCapability, importWebRecordingToProjectCapability, readWebAppRecordingCapability, renderWebAppReplayCapability, startWebAppRecordingCapability, stopWebAppRecordingCapability } from '@/core/application-control/domains/screenRecording/webAppCapability'
import { webReplayRenderOutput } from '@/core/webReplay/renderResult'
import { abortedByRevocation } from '@/core/application-control/execution/cancelReason'
import { importWebRecordingToVideo } from './webRecordingVideoImport'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { getPlatform } from '@/platform'
import { finishWebAppBackupAudio, startWebAppBackupAudio } from './webAppBackupAudio'
import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { DEFAULT_WEB_APP_BACKUP, loadRecordingSetup, webAppBackupOptions } from '@/services/recordingSetupModel'
import { WEB_APP_RECORDING_DISABLED_MESSAGE, webAppRecordingEnabled } from '../useWebAppRecordingSwitch'

import { WEB_RECORDING_LIBRARY_TYPE, WEB_RECORDING_TYPE } from './webAppRecordingCollectionExecutor'
import { WEB_RECORDING_NAME, webAppSchemaRef, webRecordingDisplayName, webRecordingFields } from './webAppRecordingFields'

const logger = createLogger('features.screenRecording.web_app_capability')
const APP = 'screen_recording.web_app'
const RECORDING = WEB_RECORDING_TYPE
const LIBRARY = WEB_RECORDING_LIBRARY_TYPE
type WebType = typeof APP | typeof RECORDING | typeof LIBRARY
const appReason = '连接状态由被录应用里的痕迹探针维护；开始录制用 start_web_app_recording。'
const recordingReason = '录制内容录完即锁定，只能读取、重演、改名和删除；名称用通用属性修改 screen_recording.web_recording.name（可撤销）；停止用 stop_web_app_recording，重演出视频用 render_web_app_replay，删除用通用集合删除（父级 screen_recording.web_recording_library/default）。'
const libraryReason = '网页录制库是固定容器；其中的录制由 stop_web_app_recording 产生，用通用集合删除移除，删除可撤销。'
const reasonOf = (type: WebType): string => (type === APP ? appReason : type === LIBRARY ? libraryReason : recordingReason)

const schemaRef = webAppSchemaRef
const detailsSchema = z.object({
  app: z.string(), version: z.string(), host: z.string(), url: z.string(), width: z.number(), height: z.number(), dpr: z.number(),
  recordingId: z.string().nullable().optional(), durationMs: z.number().optional(), warnings: z.array(z.string()).optional(), createdAt: z.string().optional(),
  /** 录制文件夹的本机路径；projectId 为所在项目（存进项目的 .hjweb），不属于项目时为 null。 */
  directory: z.string().optional(), projectId: z.string().nullable().optional(),
  /** 能直接导入剪辑的视频：最新的重演视频与备份录屏。 */
  replayVideo: z.string().nullable().optional(), backupVideo: z.string().nullable().optional(),
  /** 按导演稿重演出的版本（takes/<名字>/），新的在前；导入剪辑或读轨道时用 take 指定。 */
  takes: z.array(z.object({ name: z.string(), video: z.string().nullable(), durationMs: z.number(), frames: z.number(), fps: z.number(), pointer: z.boolean(), createdAt: z.string(), conflicts: z.number() }).strict()).optional(),
}).strict()

function properties(type: WebType): ApplicationPropertyDescriptor[] {
  const readOnlyReason = reasonOf(type)
  if (type === LIBRARY) return [{ id: `${type}.count`, entityType: type, version: 1, title: '录制数量', description: '录制数量', value: { kind: 'integer', hardRange: { min: 0 } }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['screen_recording:read'], write: [] }, revisionScopes: ['screen_recording'], schemaRef: schemaRef('property', `${type}.count`), readOnlyReason }]
  return ([['name', '名称', { kind: 'string' }], ['phase', '状态', { kind: 'string' }], ['details', '应用与录制信息', { kind: 'json', schemaRef: schemaRef('property', `${type}.details.value`) }]] as const).map(([suffix, title, value]): ApplicationPropertyDescriptor => ({
    id: `${type}.${suffix}`, entityType: type, version: 1, title, value: value as ApplicationPropertyDescriptor['value'], nullable: false, dataClass: 'C1' as const,
    exposures: ['ui', 'assistant', 'local_adapter'], revisionScopes: ['screen_recording'],
    schemaRef: schemaRef('property', `${type}.${suffix}`),
    // A recording's name is the one thing that can change after recording.
    requiredPermissions: { read: ['screen_recording:read'], write: [] }, description: title, readOnlyReason,
  })).map(descriptor => type === RECORDING && descriptor.id === WEB_RECORDING_NAME ? fieldDescriptors(webRecordingFields)[0] : descriptor)
}

async function valuesOf(type: WebType, id: string): Promise<Record<string, JsonValue>> {
  const platform = getPlatform().webReplay
  if (type === LIBRARY) {
    if (id !== 'default') throw new Error('网页录制库只有 screen_recording.web_recording_library/default')
    return { count: (await platform.recordings()).length }
  }
  if (type === APP) {
    const app = (await platform.apps()).apps.find(item => item.connectionId === id)
    if (!app) throw new Error('这个网页应用已断开，请重新列出 screen_recording.web_app')
    return { name: app.app.name, phase: app.recordingId ? 'recording' : 'connected', details: { app: app.app.name, version: app.app.version, host: app.host, url: app.env.url, width: app.env.viewport.width, height: app.env.viewport.height, dpr: app.env.viewport.dpr, recordingId: app.recordingId } }
  }
  const recording = (await platform.recordings()).find(item => item.id === id)
  if (!recording) throw new Error('没有找到这段网页录制，请重新列出 screen_recording.web_recording')
  return { name: webRecordingDisplayName(recording), phase: recording.status, details: {
    app: recording.app.name, version: recording.app.version, host: recording.host, url: recording.env.url, width: recording.env.viewport.width, height: recording.env.viewport.height, dpr: recording.env.viewport.dpr,
    durationMs: Math.round(recording.durationUs / 1000), warnings: recording.warnings.map(w => w.message), createdAt: recording.createdAt,
    directory: recording.directory, projectId: recording.projectId, replayVideo: recording.video, backupVideo: recording.backupVideo,
    takes: (recording.takes ?? []).map(take => ({ name: take.name, video: take.video, durationMs: take.durationMs, frames: take.frames, fps: take.fps, pointer: take.pointer, createdAt: take.createdAt, conflicts: take.conflicts })),
  } }
}

class WebAppProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: WebType) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
    const platform = getPlatform().webReplay
    const items = this.entityType === LIBRARY ? [{ id: 'default', label: '网页录制库' }] : this.entityType === APP
      ? (await platform.apps()).apps.map(a => ({ id: a.connectionId, label: `${a.app.name}${a.recordingId ? '（录制中）' : ''}` }))
      : (await platform.recordings()).map(r => ({ id: r.id, label: webRecordingDisplayName(r) }))
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
      if (this.entityType === RECORDING && propertyId === WEB_RECORDING_NAME) return { propertyId, readable: true, writable: true, reasons: [], requiredPermissions: ['screen_recording:write'], revisions: { screen_recording: 0 } }
      return { propertyId, readable: true, writable: false, reasons: [reasonOf(this.entityType)], requiredPermissions: ['screen_recording:read'], revisions: { screen_recording: 0 } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { return unrestrictedCollectionAvailability(this.entityType, parent, { screen_recording: 0 }, []) }
}

export function webAppRecordingRegistrations(): ApplicationEntityRegistration[] {
  return ([APP, RECORDING, LIBRARY] as const).map(type => ({
    entity: { id: type, domain: 'screen_recording', version: 1, title: type === APP ? '已接入的网页应用' : type === LIBRARY ? '网页录制库' : '网页应用录制', description: reasonOf(type), refKind: type, dataClass: 'C1' as const,
      exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: type === RECORDING ? [LIBRARY] : [], revisionScopes: ['screen_recording'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', type),
      ...(type === RECORDING ? { collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 32 } } : { writeExclusion: { reason: reasonOf(type) } }) },
    properties: properties(type), provider: new WebAppProvider(type), schemaDocuments: type === LIBRARY ? [] : [{ ref: schemaRef('property', `${type}.details.value`), value: z.toJSONSchema(detailsSchema) as JsonValue }],
  })) as ApplicationEntityRegistration[]
}

export const WEB_APP_CAPABILITY_IDS = new Set<string>([startWebAppRecordingCapability.id, stopWebAppRecordingCapability.id, readWebAppRecordingCapability.id, renderWebAppReplayCapability.id, cancelWebAppReplayCapability.id, importWebRecordingCapability.id, importWebRecordingToProjectCapability.id])
/** Saved recordings stay usable with the experimental switch off; only recording and replay need it. Cancelling must always work. */
const WORKS_WHEN_DISABLED = new Set<string>([readWebAppRecordingCapability.id, cancelWebAppReplayCapability.id, importWebRecordingCapability.id, importWebRecordingToProjectCapability.id])
const UUID = z.string().uuid()

/** Handlers for the web app recording capabilities; all real work happens in the main-process service. */
export async function executeWebAppCapability(id: string, input: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const platform = getPlatform().webReplay
  const permissions = context.callerGrant?.permissions
  // Reading saved recordings stays available; recording and replay need the experimental switch.
  // 开关没开是执行前的拒绝：明确标成未执行，打开开关后可以直接重试，不必核对
  if (!WORKS_WHEN_DISABLED.has(id) && !webAppRecordingEnabled()) throw notExecutedFailure(new Error(WEB_APP_RECORDING_DISABLED_MESSAGE))
  if (id === startWebAppRecordingCapability.id) {
    const parsed = startWebAppRecordingCapability.inputSchema.parse(input)
    if (parsed.projectId && permissions && !permissions.includes('documents:write')) throw new Error('PERMISSION_DENIED:存进项目还需要 documents:write 权限')
    // The backup screen recording follows the choices on the recording page.
    const backup = loadRecordingSetup().setup.webAppBackup ?? DEFAULT_WEB_APP_BACKUP
    const manifest = await platform.start(parsed.appRef.id, webAppBackupOptions(backup, backup.enabled && backup.range === 'screen' ? await getPlatform().screenRecording.sources() : []), parsed.projectId ? { projectId: parsed.projectId, ...(parsed.name ? { name: parsed.name } : {}) } : null)
    await startWebAppBackupAudio(manifest.id, backup).catch(error => logger.warn('备份录屏的声音没能开始录制', { event: 'web_replay.backup_audio.start_failed', error: String(error) }))
    const saved = (await platform.recordings()).find(r => r.id === manifest.id)
    return { resultRef: { kind: RECORDING, id: manifest.id }, directory: saved?.directory ?? '', verified: Boolean(saved) }
  }
  if (id === importWebRecordingCapability.id) {
    if (permissions && !permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:导入剪辑需要 screen_recording:read 权限')
    const parsed = importWebRecordingCapability.inputSchema.parse(input)
    const result = await importWebRecordingToVideo(parsed.recordingRef.id, parsed.destination, parsed.video, context.signal, parsed.take)
    return { resultRef: { kind: 'video_edit.document', id: parsed.destination.documentId }, ...result, verified: result.itemIds.length > 0 && (!parsed.destination.sequenceId || result.clipIds.length > 0) }
  }
  if (id === importWebRecordingToProjectCapability.id) {
    if (permissions && !permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:读取网页录制需要 screen_recording:read 权限')
    const parsed = importWebRecordingToProjectCapability.inputSchema.parse(input)
    const summary = await platform.importToProject({ projectId: parsed.projectId, ...(parsed.recordingRef ? { recordingId: parsed.recordingRef.id } : {}), ...(parsed.path ? { source: parsed.path } : {}), ...(parsed.name ? { name: parsed.name } : {}) })
      .catch((error: unknown) => { throw error instanceof Error && error.name === 'WebRecordingNotImportedError' ? notExecutedFailure(error) : error })
    const listed = (await getPlatform().documents.listDocuments({ kind: 'web_recording', includeMissing: false })).some(document => document.id === summary.id)
    return { resultRef: { kind: RECORDING, id: summary.id }, documentRef: { kind: 'documents.document', id: summary.id }, directory: summary.directory, verified: listed && summary.projectId === parsed.projectId }
  }
  if (id === stopWebAppRecordingCapability.id) {
    const parsed = stopWebAppRecordingCapability.inputSchema.parse(input)
    await finishWebAppBackupAudio(parsed.recordingRef.id)
    const manifest = await platform.stop(parsed.recordingRef.id)
    const status = manifest.status === 'complete' ? 'complete' : 'interrupted'
    return { resultRef: parsed.recordingRef, status, durationMs: Math.round(manifest.durationUs / 1000), warnings: manifest.warnings.map(w => w.message), verified: (await platform.recordings()).find(r => r.id === manifest.id)?.status === status }
  }
  if (id === cancelWebAppReplayCapability.id) {
    const parsed = cancelWebAppReplayCapability.inputSchema.parse(input)
    // 没有可取消的重演是登记的写入前拒绝（rejectionErrors.ts），写执行层直接判为未执行
    const cancelled = await platform.cancelRender({ recordingId: parsed.recordingRef.id })
    return { resultRef: parsed.recordingRef, previousState: cancelled.previousState, state: cancelled.state, verified: cancelled.state === 'cancelled' }
  }
  if (id === readWebAppRecordingCapability.id) {
    if (permissions && !permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:读取网页录制需要 screen_recording:read 权限')
    const parsed = readWebAppRecordingCapability.inputSchema.parse(input)
    const { recordingRef, ...request } = parsed
    return { ...await platform.read({ recordingId: recordingRef.id, ...request }) }
  }
  const parsed = renderWebAppReplayCapability.inputSchema.parse(input)
  context.signal.throwIfAborted()
  const longEdge = { recorded: undefined, '1080p': 1920, '1440p': 2560, '4k': 3840 }[parsed.resolution]
  const director = { ...(parsed.director ? { director: parsed.director } : {}), ...(parsed.directorFile ? { directorFile: parsed.directorFile } : {}), ...(parsed.take ? { take: parsed.take } : {}) }
  // 主进程按操作标识登记这次重演：渲染层重载后账本凭它找回结果。只有撤销授权会停下重演；宿主断开、
  // 页面重载、宿主卸载中止的只是这边的等待，重演照常跑完、结果记进原操作。调用方要停用 cancel_web_app_replay。
  const jobId = UUID.safeParse(context.requestId).success ? context.requestId! : crypto.randomUUID()
  const cancel = (): void => { if (!abortedByRevocation(context.signal)) return; void platform.cancelRender({ jobId }).catch((error: unknown) => logger.warn('网页重演没能取消', { event: 'web_replay.replay.cancel_failed', requestId: jobId, error: String(error) })) }
  context.signal.addEventListener('abort', cancel, { once: true })
  try {
    // 导演稿不对、同一段已在重演、被取消都是登记的写入前拒绝（rejectionErrors.ts），写执行层直接判为未执行
    const result = await platform.render({ recordingId: parsed.recordingRef.id, fps: parsed.fps, pointer: parsed.pointer, ...(longEdge ? { longEdge } : {}), ...(parsed.textOnly ? { textOnly: true } : {}), ...(parsed.boxSelectors ? { boxSelectors: parsed.boxSelectors } : {}), ...director }, jobId)
    return webReplayRenderOutput(parsed.recordingRef.id, parsed.pointer, result)
  } finally { context.signal.removeEventListener('abort', cancel) }
}
