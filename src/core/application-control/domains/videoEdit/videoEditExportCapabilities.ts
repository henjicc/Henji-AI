import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditLoudnessSettingsSchema, videoEditLoudnessMeasurementSchema } from '../../../videoEdit/loudness'
import { videoEditExportSettingsSchema } from '../../../videoEdit/exportPresets'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const range = z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().refine(value => value.endFrame > value.startFrame, '出点必须晚于入点。')
const item = z.object({ documentRef: documentRef.optional(), sequenceRef: ref('video_edit.sequence').optional(), presetRef: ref('video_edit.export_preset').optional(), settings: videoEditExportSettingsSchema.optional().describe('完整导出设置；覆盖预设并严格校验，不自动替换。只传预设时按设备适配；省略预设和设置时与序列一致并按设备适配。'), fit: z.enum(['fit', 'fill', 'letterbox']).optional(), range: range.optional() }).strict()
export const videoEditExportInputSchema = z.object({ documentRef, format: z.enum(['mp4', 'aac', 'wav', 'srt', 'vtt']).optional(), settings: videoEditExportSettingsSchema.optional(), range: range.optional(), subtitleClock: z.enum(['sequence', 'range']).optional(), loudness: videoEditLoudnessSettingsSchema.optional(), exports: z.array(item).min(1).optional(), destination: canvasDownloadDestinationSchema.optional().describe('输出目录。省略时放进剪辑所在项目的“导出”文件夹；quick 为已配置快速下载目录，preset 为下载预设目录。重名自动加序号，不覆盖、不弹保存对话框。'), retryTaskId: z.string().min(1).optional() }).strict().superRefine((value, ctx) => {
  if (value.exports && (value.retryTaskId || value.format || value.settings || value.range || value.loudness || value.subtitleClock)) ctx.addIssue({ code: 'custom', message: '批量 exports 已包含各项完整设置，不能混用顶层格式、设置、范围、响度、字幕时间或重试参数。' })
  if (value.retryTaskId && (value.format || value.settings || value.range || value.loudness || value.subtitleClock)) ctx.addIssue({ code: 'custom', message: '重试使用原快照与设置，不可同时更改格式、设置、范围或响度。' })
  if ((value.format === 'srt' || value.format === 'vtt') && value.range) ctx.addIssue({ code: 'custom', message: '独立字幕导出使用时间线入出点；自定义范围字幕请用 settings.captionMode 随成片导出。' })
  if (value.subtitleClock && value.format !== 'srt' && value.format !== 'vtt') ctx.addIssue({ code: 'custom', message: 'subtitleClock 只用于字幕文件。' })
  if (value.settings && (value.format || value.loudness || value.subtitleClock)) ctx.addIssue({ code: 'custom', message: '完整 settings 不能与顶层格式、响度或字幕时间混用。' })
})
export const videoEditExportJobSummarySchema = z.object({
  id: z.string(), documentRef, sequenceRef: ref('video_edit.sequence'), name: z.string(), presetName: z.string(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().min(0).max(1), range, settings: videoEditExportSettingsSchema,
  taskId: z.string().optional(), error: z.string().optional(), notice: z.string().optional(), outputReady: z.boolean(), assetRef: ref('asset').optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(),
}).strict()
const task = z.object({ id: z.string(), state: z.enum(['running', 'completed', 'failed', 'cancelled']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), loudness: videoEditLoudnessSettingsSchema.optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(), notice: z.string().optional() }).strict()
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }).strict(), queue: z.array(videoEditExportJobSummarySchema), task: task.optional() }).strict()
export const videoEditExportQuerySchema = z.object({ documentRef, taskId: z.string().min(1).optional() }).strict()
const descriptions = {
  export_video_edit: ['导出剪辑成片或字幕', '默认与序列一致，或用通用实体读取 video_edit.export_preset，exports 每项用 presetRef/完整 settings；sequenceRef 和 documentRef 可指定其他原序列/已打开剪辑。settings.codec=avc(H.264)/hevc，bitrateMode=vbr/cbr，keyframeInterval=auto/1/2秒，encoderPreference=hardware/software；完整settings在设备不支持所选组合时明确拒绝，不替换编码；只传预设或省略设置时，沿面板同一设备适配选择可用编码、性能、码率模式和推荐码率，并在queue.settings回读实际设置。followSequence 的 resolution/fps/sampleRate/channels 为 true 时提交读取原序列值。videoEnabled=false 仅音频，audioEnabled=false 无声视频；audioCodec=aac/wav(24位PCM)，sampleRate为Hz，channels=1/2。loudness=null 不标准化；captionMode=none/burn/srt/vtt，同名字幕与成片同目录，以导出入点为零。useProxies显式用已有代理画面，声音用原片；importToProject导入原项目；addToLibrary默认true，需要assets:write授权，否则设false并沿既有收录能力另收录。range为整数帧半开范围；省略用序列入出点，无标记则整序列。用户选择文件后进入顺序队列，query_video_edit_export回读完成；retryTaskId只重试未发布文件的失败项。独立字幕format=srt/vtt，subtitleClock默认range，可选sequence。'],
  query_video_edit_export: ['查询剪辑导出', '读取此剪辑的全部导出项：排队、进度、取消、失败原因、预设、范围、PCM 响度和最终状态。assetRef 为自动收录的素材引用；outputReady 表示有已核验输出，可用 collect_video_edit_output 与 id 或 taskId 收录。只观察，不等待、不取消。'],
  cancel_video_edit_export: ['取消剪辑导出', 'taskId 指定此剪辑的单项导出（取 queue.id）；省略则取消此剪辑全部未完成项及旧导出。清理未完成文件，保留已发布文件。'],
} as const
export const VIDEO_EDIT_EXPORT_CAPABILITIES = (Object.keys(descriptions) as Array<keyof typeof descriptions>).map(id => defineApplicationCapability({
  id, title: descriptions[id][0], description: descriptions[id][1], version: 1, domain: 'video_edit', aliases: [descriptions[id][0], '导出抖音竖版和B站横版'],
  readOnly: id === 'query_video_edit_export', risk: id === 'query_video_edit_export' ? 'R0' : 'R1', dataClasses: ['C1'], permission: id === 'query_video_edit_export' ? 'video_edit:read' : 'video_edit:write',
  idempotent: id !== 'export_video_edit', destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.export_preset'], producesRefs: ['video_edit.document'],
  concurrencyKey: 'video_edit_export', resolveConcurrencyKey: parsed => `video_edit_export:${parsed.documentRef.id}`,
  inputSchema: id === 'export_video_edit' ? videoEditExportInputSchema : videoEditExportQuerySchema, outputSchema: output,
  resolveOperationTargets: parsed => [parsed.documentRef, ...('exports' in parsed ? parsed.exports?.flatMap(value => value.documentRef ? [value.documentRef] : []) ?? [] : [])],
  resolveOperationWriteTargets: parsed => id === 'query_video_edit_export' ? [] : [parsed.documentRef, ...('exports' in parsed ? parsed.exports?.flatMap(value => value.documentRef ? [value.documentRef] : []) ?? [] : [])],
  control: capabilityControl(id === 'query_video_edit_export' ? 'observe' : 'execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'] }),
  summarize: result => result.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [...new Map([result.resultRef, ...result.queue.map(job => job.documentRef)].map(target => [target.id, target])).values()].map(target => ({
    effect: id === 'query_video_edit_export' ? 'observe' as const : 'execute' as const, entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [target], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [],
  })),
}))
