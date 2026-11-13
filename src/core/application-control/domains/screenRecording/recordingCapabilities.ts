import { z } from 'zod'
import { captureEventSchema } from '../../../captureLog/events'
import { recordingTrackOptionsSchema } from '../../../screenRecording/tracks'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { understandRecordingCapability } from './understandingCapability'
import { generateRecordingMovieCapability } from './movieCapability'
import { detectRecordingPrivacyCapability } from './privacyCapability'
import { exportRecordingProductCapability, cancelRecordingExportCapability } from './productCapability'
import { recordingScriptCapabilities } from './scriptCapability'
import { recordingDirectorCapabilities } from './directorCapability'
import { WEB_APP_RECORDING_CAPABILITIES } from './webAppCapability'

const RECORDING_DOMAIN = 'screen_recording'
export const recordingRefSchema = z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict()
export const recordingDestinationSchema = z.object({ documentId: z.string().min(1), sequenceId: z.string().min(1).optional(), frame: z.number().int().nonnegative().optional() }).strict()
export const startRecordingInputSchema = z.object({
  sourceRef: z.object({ kind: z.literal('screen_recording.source'), id: z.string().regex(/^(screen|window):\d+:\d+$/) }).strict().describe('先列出 screen_recording.source，选择显示器或窗口'),
  name: z.string().trim().min(1).max(120).describe('录制会话名称'),
  width: z.number().int().min(2).max(3840).multipleOf(2).optional().describe('与 height 一起给或一起省略；省略时用用户在录屏设置里保存的清晰度'),
  height: z.number().int().min(2).max(2160).multipleOf(2).optional(),
  fps: z.union([z.literal(30), z.literal(60)]).optional().describe('省略时用录屏设置里保存的帧率'),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional().describe('可选显示器比例区域；窗口不支持裁区'),
  tracks: recordingTrackOptionsSchema.optional().describe('麦克风、系统声音和摄像头；整个省略时跟随录屏设置里保存的开关与摄像头。给出时只录写明的轨道，省略设备标识使用默认设备。权限由系统确认'),
  projectId: z.string().min(1).optional(),
  destination: recordingDestinationSchema.optional().describe('可选目标剪辑文档；给 sequenceId 时按共享时钟放到 frame 播放头，否则只导入素材库。始终绑定此目标，不随页面切换'),
}).strict()
const output = capabilityOutputSchema({ resultRef: recordingRefSchema, verified: z.boolean(),
  finishing: z.boolean().optional().describe('等了约 45 秒仍没做完（收尾、恢复或导入）：照常在后台进行，不要重发；读会话 details，finishing 变回 false 后 details.error 有值就是失败及原因，没有就是做完了'),
  message: z.string().optional() })
// These operations expose user document metadata and sanitized event facts, never pixels, audio or typed text.
const common = { version: 1, domain: RECORDING_DOMAIN, readOnly: false, dataClasses: ['C1' as const], idempotent: false, destructive: false,
  timeoutMs: 60000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording', outputSchema: output }
const start = defineApplicationCapability({ ...common, id: 'start_screen_recording', title: '开始屏幕录制',
  description: '录制所选显示器、窗口或比例区域，同时采集选定声音、摄像头和操作事件。倒计时后后台录制，切页、界面重载都不会中断。分辨率、帧率、声音与摄像头省略时跟随用户在录屏设置里保存的值（与点录屏页“开始录制”一致）。音频编辑正在录音时麦克风照常可用（两边共用一路采集，互不打断）。需要屏幕及所选设备的系统权限，不收费。返回录制会话引用，通用读取其 phase/elapsed_ms 与 details（长录事实：各轨空档、丢帧、续录、补静音）；用 stop_screen_recording 保存或 cancel_screen_recording 中止。',
  aliases: ['录屏', '开始录制', 'screen recording'], inputSchema: startRecordingInputSchema,
  producesRefs: ['screen_recording.session'], acceptsRefs: ['screen_recording.source', 'video_edit.document'],
  resolveOperationTargets: input => [input.sourceRef, ...(input.destination ? [{ kind: 'video_edit.document', id: input.destination.documentId }] : [])],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'screen_recording.session', id: `pending:${operationId}` }],
  completionKind: 'submitted',
  control: capabilityControl('create', ['screen_recording.session'], { cancelable: true, mode: 'long_running', resultState: 'submitted' }),
  summarize: result => result.message ?? '录制会话已准备，倒计时后开始；可读取会话查看进度。',
})
const controls = [
  ['pause', '暂停录制', '暂停屏幕、声音、摄像头与事件，保留真实空档。'],
  ['resume', '恢复录制', '恢复暂停的全部录制轨道，共用原时钟继续采集。'],
  ['mark', '标记录制时刻', '在当前真实录制时刻采集重点标记，可附备注。'],
  ['stop', '停止并保存录制', '停止全部轨道并等待媒体、事件与会话保存；如开始时指定剪辑目标，导入该目标。最多等约 45 秒：长录收尾（拼接声音、导入）没做完时先返回 finishing=true，收尾照常进行；之后读会话 phase 与 details.finishing，不要再次停止。'],
  ['cancel', '中止录制', '释放全部采集设备与输入钩子；已封存片段仍可从会话恢复，不删除原片。'],
  ['recover', '恢复中断的录制', '关闭采集后检查已落盘分片与事件页，恢复可播放片段，补齐没封口的声音分段并拼接声音；不重启设备、不重放操作。没能恢复的时段在 details.tracks 里按缺数据空档列出。最多等约 45 秒，没做完返回 finishing=true，照常在后台进行，读 details.finishing。'],
] as const
/** 停止、恢复、导入可能要很久（两小时的声音拼接、补齐分片、导入剪辑）：处理器只等约 45 秒，没做完就说明仍在进行、去哪查。 */
const finishingResult = (done: string) => (result: { finishing?: boolean; message?: string }): string => result.finishing ? result.message ?? '仍在后台进行；读会话 details，finishing 变回 false 后看 details.error 判断成败。' : done
export const RECORDING_CAPABILITIES = [start, ...WEB_APP_RECORDING_CAPABILITIES, ...recordingDirectorCapabilities, ...recordingScriptCapabilities, understandRecordingCapability, generateRecordingMovieCapability, detectRecordingPrivacyCapability, exportRecordingProductCapability, cancelRecordingExportCapability, ...controls.map(([action, title, description]) => defineApplicationCapability({
  ...common, id: `${action}_screen_recording`, title, description, aliases: [title], acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.session'],
  inputSchema: z.object({ sessionRef: recordingRefSchema, ...(action === 'mark' ? { note: z.string().max(4000).optional() } : {}) }).strict(),
  resolveOperationTargets: input => [input.sessionRef],
  control: capabilityControl('execute', ['screen_recording.session']), summarize: finishingResult(`${title}已完成。`),
})), defineApplicationCapability({
  ...common, id: 'read_screen_recording_events', title: '读取录制事件', description: '分页校验并读取已封存的录制事件或标记。offset 从 0 开始，按返回的 nextOffset 续读；暂停期间无虚构事件，按键只有类别。',
  aliases: ['读录屏日志', '录制标记'], readOnly: true, idempotent: true,
  inputSchema: z.object({ sessionRef: recordingRefSchema, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(256).default(100), markersOnly: z.boolean().default(false) }).strict(),
  outputSchema: capabilityOutputSchema({ events: z.array(captureEventSchema), nextOffset: z.number().int().nonnegative().nullable() }),
  acceptsRefs: ['screen_recording.session'], control: capabilityControl('observe', ['screen_recording.session']), summarize: result => `已读取 ${result.events.length} 条事件。`,
}), defineApplicationCapability({
  ...common, id: 'import_screen_recording', title: '将录制导入剪辑', description: '把已保存或恢复的会话原片引用导入指定剪辑素材库；给 sequenceId 时按同一时钟放到 frame 处，保留暂停与缺帧空档，一步撤销。无需复制文件。最多等约 45 秒，长录没导完时返回 finishing=true、itemIds 为空，导入照常进行：读会话 details.finishing，完成后读剪辑素材。',
  aliases: ['录屏进剪辑', '录制素材导入'], supportsUndo: true,
  inputSchema: z.object({ sessionRef: recordingRefSchema, destination: recordingDestinationSchema }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: z.object({ kind: z.literal('video_edit.document'), id: z.string() }).strict(), itemIds: z.array(z.string()), verified: z.boolean(), finishing: z.boolean().optional(), message: z.string().optional() }),
  acceptsRefs: ['screen_recording.session', 'video_edit.document'], producesRefs: ['video_edit.document'],
  resolveOperationTargets: input => [input.sessionRef, { kind: 'video_edit.document', id: input.destination.documentId }],
  resolveOperationWriteTargets: input => [{ kind: 'video_edit.document', id: input.destination.documentId }],
  resolveConcurrencyKey: input => `video_edit:${input.destination.documentId}`,
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true }), summarize: result => result.finishing ? result.message ?? '导入仍在进行。' : `已导入 ${result.itemIds.length} 项录制素材。`,
})]
