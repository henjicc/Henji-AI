import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { getPlatform } from '@/platform'
import { recordingDevices } from '../tracks/devices'
import { recordingDocumentSchema } from '@/core/screenRecording/document'
import { recordingDurationUs } from '@/core/screenRecording/range'
import { recordingTrackKindSchema, recordingTrackOptionsSchema, recordingTrackWarningSchema, type RecordingTracks } from '@/core/screenRecording/tracks'
import { captureActivityTimelineFile, captureFrameTimingFile, type RecordingCaptureFacts } from '@/core/screenRecording/capture'
import { recordingProductExports, recordingProductExport } from './recordingProductService'
import { recordingView } from './recordingService'
import { recordingWorkFailure, recordingWorkInProgress } from './recordingWork'

const types = ['screen_recording.session', 'screen_recording.source', 'screen_recording.device', 'screen_recording.export'] as const
const reason = '采集事实由统一录制服务维护；开始、暂停、恢复、标记、停止和恢复使用录制语义操作，文档改名与删除走 documents.document。'
const exportReason = '导出状态由 export_screen_recording_product 与 cancel_screen_recording_export 维护，运行期结果不可直接修改；标准文件和正式图片文档永久保留。'
function schemaRef(kind: 'entity' | 'property', id: string) {
  const seed = [...id].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${seed.padEnd(64, seed).slice(0, 64)}` } as const
}
const detailsSchema = z.object({
  source: z.string().optional(), cursorEmbedded: z.boolean().optional(),
  media: z.array(z.object({ id: z.string(), kind: z.string(), monoUs: z.number(), durationUs: z.number() }).strict()).describe('录制原件：画面按暂停分成几个文件、声音每路按暂停分成几条；导入剪辑时拼成一个画面素材与每路一条声音').optional(),
  markers: z.number().int().nonnegative().optional().describe('已封存的标记数；录制中省略，录制中用 read_screen_recording_events 读'),
  events: z.number().int().nonnegative().optional().describe('已封存的事件数；录制中省略，录制中用 read_screen_recording_events 分页读'),
  deviceKind: z.string().optional(), sourceKind: z.string().optional(),
  display: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(), scaleFactor: z.number(), primary: z.boolean(),
    pixelWidth: z.number().int(), pixelHeight: z.number().int(),
  }).strict().optional().describe('显示器来源：x/y/width/height 是桌面坐标里的位置与大小（缩放前），pixelWidth/pixelHeight 是实际像素分辨率，primary 表示是否主屏；窗口来源省略'),
  devices: recordingTrackOptionsSchema.optional(), deviceId: z.string().optional(),
  product: z.string().optional(), sessionId: z.string().optional(), files: z.array(z.string()).optional(),
  documentRefs: z.array(z.object({ kind: z.literal('documents.document'), id: z.string() }).strict()).optional(),
  steps: z.array(z.object({ id: z.string(), title: z.string(), startUs: z.number(), endUs: z.number() }).strict()).optional(),
  completedSteps: z.number().optional(), warnings: z.array(z.string()).optional(), verified: z.boolean().optional(), error: z.string().optional(),
  // 以下为长录事实：各轨的分段与空档（缺数据、设备断开、静音、暂停）、采集计数、停止后是否还在收尾。
  tracks: z.array(z.object({
    kind: recordingTrackKindSchema, segments: z.number().int().nonnegative(),
    gaps: z.object({ pause: z.number().int().nonnegative(), device: z.number().int().nonnegative(), muted: z.number().int().nonnegative(), missingData: z.number().int().nonnegative() }).strict(),
    missingSeconds: z.number().nonnegative().describe('缺数据与设备断开空档的总秒数（暂停不算）'), warnings: z.array(recordingTrackWarningSchema),
  }).strict()).optional(),
  capture: z.object({
    live: z.boolean(), failure: z.string().nullable(), detaches: z.number().int().nonnegative().describe('界面进程断开（重载、崩溃）次数：断开期间摄像头（与 macOS 的系统声）没有数据，记为缺数据空档；麦克风照常录'),
    video: z.object({ droppedFrames: z.number(), duplicatedFrames: z.number(), encoderRestarts: z.number().describe('编码进程意外退出后自动续录的次数，每次画面留空一两秒'), encoder: z.string() }).strict().nullable(),
    systemAudio: z.object({ silenceSeconds: z.number().describe('没有声音播放时补的静音'), unavailableSeconds: z.number().describe('输出设备不可用或被独占时补的静音'), droppedFrames: z.number().describe('写盘跟不上丢的帧，已补等长静音'), discontinuities: z.number(), deviceSwitches: z.number(), reconnects: z.number() }).strict().nullable(),
    microphone: z.object({ device: z.string().describe('实际用的麦克风；音频编辑正在录音时与它共用同一个设备'), inputOverflows: z.number(), inputUnderflows: z.number(), droppedFrames: z.number().describe('写盘跟不上丢的帧，已补等长静音'), droppedPreviewBlocks: z.number().describe('麦克风轨由原生录音进程直接落盘，不经推送，通常为 0'), reconnects: z.number().describe('设备拔出或录音进程失联后自动重连的次数，每次留一段空档') }).strict().nullable(),
    recovered: z.boolean().describe('应用上次意外退出后，启动时自动补齐的'),
    sourceEnded: z.string().optional().describe('录制因被录的窗口关闭或显示器断开而自动停止时的说明；这是正常结尾，不是失败，已录内容照常保存、可以导入'),
  }).strict().nullable().optional().describe('采集计数只在本次运行内有；应用重启后为 null，只剩 tracks 与 phase。null（整体或某一项）表示不知道，不等于没有丢帧或空档'),
  recorder: z.enum(['native', 'ffmpeg_or_browser']).optional().describe('画面用哪种录法录的：native 是自研原生画面采集（画面旁有逐帧时刻表与活动时间线），ffmpeg_or_browser 是 FFmpeg 或界面采集的现有录法（没有这两样，光标与画面按录制时钟对齐）；没有画面轨时省略'),
  frameTiming: z.object({ path: z.string(), exists: z.boolean() }).strict().optional().describe('画面旁的逐帧时刻表（每帧的采集时刻、丢帧与暂停标记，二进制），只有原生画面采集录的才有；导入剪辑与光标对齐已经按它换算，助手一般不需要直接读'),
  activity: z.object({ path: z.string(), exists: z.boolean() }).strict().optional().describe('画面旁的活动时间线（一行一条 JSON：每秒新画面数与编码字节数、前台窗口与标题、暂停/继续/停止），只有原生画面采集录的才有，粗剪时可用来找操作密集与静止的段落'),
  finishing: z.boolean().optional().describe('停止后的收尾、恢复或导入仍在后台进行；为 true 时等待，不要重发。变回 false 后看 error：有值就是失败及原因，没有就是做完了'),
}).strict()
/** 各轨的分段与空档汇总：录制中来自主进程的实时轨道，停止后来自录制文档。 */
function trackFacts(tracks: RecordingTracks | null | undefined): NonNullable<z.infer<typeof detailsSchema>['tracks']> {
  return (tracks?.tracks ?? []).map(track => {
    const count = (reason: string): number => track.gaps.filter(gap => gap.reason === reason).length
    const missing = track.gaps.filter(gap => gap.reason === 'missing-data' || gap.reason === 'device').reduce((sum, gap) => sum + gap.monoSpanUs[1] - gap.monoSpanUs[0], 0)
    return { kind: track.kind, segments: track.segments.length, gaps: { pause: count('pause'), device: count('device'), muted: count('muted'), missingData: count('missing-data') }, missingSeconds: Math.round(missing / 1000) / 1000, warnings: [...track.warnings] }
  })
}
function properties(type: string): ApplicationPropertyDescriptor[] {
  const readOnlyReason = type === 'screen_recording.export' ? exportReason : reason
  return [
    ['name', '名称', { kind: 'string' }], ['phase', '录制状态', { kind: 'string' }], ['elapsed_ms', '已录制毫秒（不含暂停，录制中与停止后同一口径）', { kind: 'number' }],
    ['details', '轨道与事件摘要', { kind: 'json', schemaRef: schemaRef('property', `${type}.details.value`) }],
  ].map(([suffix, title, value]) => ({ id: `${type}.${suffix}`, entityType: type, version: 1, title: title as string, description: title as string,
    value: value as ApplicationPropertyDescriptor['value'], nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['screen_recording:read'], write: [] },
    revisionScopes: ['screen_recording'], schemaRef: schemaRef('property', `${type}.${suffix}`), readOnlyReason }))
}
class RecordingProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: typeof types[number]) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
    const items = this.entityType === 'screen_recording.export' ? recordingProductExports().map(item => ({ id: item.id, name: item.product })) : this.entityType === 'screen_recording.session' ? (await getPlatform().documents.listDocuments({ kind: 'screen_recording', includeMissing: false })).map(item => ({ id: item.id, name: item.name }))
      : this.entityType === 'screen_recording.source' ? await getPlatform().screenRecording.sources()
        : (await recordingDevices()).filter(item => item.id).map(item => ({ id: `${item.kind}:${item.id}`, name: item.label || item.kind }))
    return { refs: items.slice(offset, offset + request.limit).map(item => ({ kind: this.entityType, id: item.id, label: item.name })), nextCursor: offset + request.limit < items.length ? String(offset + request.limit) : null, revisions: { screen_recording: 0 } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    let values: Record<string, JsonValue>
    let revision = 0
    if (this.entityType === 'screen_recording.export') {
      const { id: _id, state, ...details } = recordingProductExport(ref.id)
      values = { name: details.product, phase: state, elapsed_ms: 0, details: { ...details } }
    } else if (this.entityType === 'screen_recording.session') {
      const read = await getPlatform().documents.readDocument({ id: ref.id })
      if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
      const content = recordingDocumentSchema.parse(read.content), meta = read.meta
      const snapshot = await getPlatform().screenRecording.snapshot()
      const active = snapshot?.sessionId === content.sessionId ? snapshot : null
      const facts = await getPlatform().screenRecording.capture({ operation: 'facts', sessionId: ref.id }).catch(() => null) as RecordingCaptureFacts | null
      const { tracks: liveTracks, ...capture } = facts ?? { tracks: undefined }
      const view = recordingView()
      const screenFile = content.media.find(media => media.kind === 'screen')?.path
      // 两个旁注文件只有原生采集会写，有任一个就是原生录的；录制中也已在写，读回随时可用。
      // 查不了文件时不给录法，免得把原生录的说成现有录法。
      const sidecar = async (file: string) => ({ path: file, exists: await (async () => getPlatform().system.fs.exists(file))().catch(() => null) })
      const [frameTiming, activity] = screenFile ? await Promise.all([sidecar(captureFrameTimingFile(screenFile)), sidecar(captureActivityTimelineFile(screenFile))]) : []
      const native = Boolean(frameTiming?.exists || activity?.exists)
      const known = native || (frameTiming?.exists === false && activity?.exists === false)
      revision = meta.revision
      // 录制中事件与标记还在主进程里，没封存进会话文档，这时给计数只会是假的 0；录制中读 read_screen_recording_events。
      const sealed = !active
      // 录制中与停止后同一口径：都不含暂停。
      values = { name: meta.name, phase: active?.phase ?? content.status, elapsed_ms: active ? active.elapsedMs : Math.round(recordingDurationUs(content) / 1000), details: {
        source: content.source?.name ?? '', cursorEmbedded: content.source?.cursorEmbedded ?? false, media: content.media,
        ...(sealed ? { markers: content.markers.length, events: content.eventPages.reduce((sum, page) => sum + page.lastSequence - page.firstSequence + 1, 0) } : {}),
        devices: content.devices,
        tracks: trackFacts(liveTracks ?? content.tracks) as unknown as JsonValue, capture: facts ? capture as unknown as JsonValue : null,
        ...(known ? { recorder: native ? 'native' : 'ffmpeg_or_browser' } : {}),
        ...(native && frameTiming!.exists !== null ? { frameTiming: { path: frameTiming!.path, exists: frameTiming!.exists } } : {}),
        ...(native && activity!.exists !== null ? { activity: { path: activity!.path, exists: activity!.exists } } : {}),
        ...(facts?.failure || recordingWorkFailure(ref.id) ? { error: [facts?.failure, recordingWorkFailure(ref.id)].filter(Boolean).join('；') } : {}),
        finishing: recordingWorkInProgress(ref.id) || Boolean(active?.phase === 'stopped' && active.busy || view.busy && view.documentId === ref.id && active?.phase !== 'recording'),
      } }
    } else {
      const source = this.entityType === 'screen_recording.source' ? (await getPlatform().screenRecording.sources()).find(item => item.id === ref.id) : undefined
      const device = this.entityType === 'screen_recording.device' ? (await recordingDevices()).find(item => `${item.kind}:${item.id}` === ref.id) : undefined
      if (!source && !device) throw new Error('来源或设备已移除，请重新列出')
      const display = source?.display
      values = { name: source?.name ?? device?.label ?? '', phase: 'available', elapsed_ms: 0, details: source ? { sourceKind: source.kind,
        ...(display ? { display: { ...display, pixelWidth: Math.round(display.width * display.scaleFactor), pixelHeight: Math.round(display.height * display.scaleFactor) } } : {}) } : { deviceKind: device!.kind, deviceId: device!.id } }
    }
    return { ref, entityType: this.entityType, revisions: { screen_recording: revision }, capturedAt: new Date().toISOString(), properties: Object.fromEntries(Object.entries(values).map(([key, value]) => [`${this.entityType}.${key}`, value]).filter(([key]) => !request.propertyIds || request.propertyIds.includes(String(key)))) }
  }
  async getPropertyAvailability(ref: ApplicationRef, ids: string[]) {
    const snapshot = await this.readEntity(ref, {})
    return ids.map(propertyId => {
      if (!properties(this.entityType).some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: [this.entityType === 'screen_recording.export' ? exportReason : reason], requiredPermissions: ['screen_recording:read'], revisions: snapshot.revisions }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { return unrestrictedCollectionAvailability(this.entityType, parent, { screen_recording: 0 }, []) }
}
export function recordingRegistrations(): ApplicationEntityRegistration[] {
  return types.map(type => ({ entity: { id: type, domain: 'screen_recording', version: 1, title: { 'screen_recording.session': '录制会话', 'screen_recording.source': '可录制来源', 'screen_recording.device': '录制设备', 'screen_recording.export': '录制产物导出' }[type],
    description: type === 'screen_recording.export' ? exportReason : reason, refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['screen_recording'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', type), writeExclusion: { reason: type === 'screen_recording.export' ? exportReason : reason } },
    properties: properties(type), provider: new RecordingProvider(type), schemaDocuments: [{ ref: schemaRef('property', `${type}.details.value`), value: z.toJSONSchema(detailsSchema) as JsonValue }],
  }))
}
