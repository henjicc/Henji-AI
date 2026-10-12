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
  path: z.string().optional(), completedAt: z.number().optional(), archived: z.boolean().optional(),
  taskId: z.string().optional(), error: z.string().optional(), notice: z.string().optional(), outputReady: z.boolean(), assetRef: ref('asset').optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(),
}).strict()
const task = z.object({ id: z.string(), state: z.enum(['running', 'completed', 'failed', 'cancelled']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), loudness: videoEditLoudnessSettingsSchema.optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(), notice: z.string().optional() }).strict()
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }).strict(), queue: z.array(videoEditExportJobSummarySchema), task: task.optional() }).strict()
export const videoEditExportQuerySchema = z.object({ documentRef, taskId: z.string().min(1).optional() }).strict()
const descriptions = {
  export_video_edit: ['导出剪辑成片或字幕', '导出后用 query_video_edit_export 查完成。默认与序列一致；通用实体 video_edit.export_preset 提供预设，批量 exports 每项指定 presetRef/完整 settings，可用 documentRef/sequenceRef 选择原剪辑/序列。完整 settings 不支持则拒绝；预设/缺省设置按设备适配，queue.settings 回读实际值。followSequence 在提交时读取序列值；videoEnabled/audioEnabled 控制画面/声音，sampleRate 为 Hz，wav 为24位PCM；loudness=null 不标准化。captionMode 导出同名字幕，以导出入点为零；独立 srt/vtt 的 subtitleClock 默认 range，可选 sequence。useProxies 只用代理画面、声音用原片；importToProject 导入原项目；addToLibrary 默认 true，需 assets:write，否则设 false 再收录。range 为整数帧半开范围；省略用入出点，无标记则整序列。retryTaskId 只重试未发布文件的失败项。'],
  query_video_edit_export: ['查询剪辑导出', '读取此剪辑的全部导出项，包含重启后保留的完成记录（assetRef、path、completedAt、settings）；taskId 接受队列或渲染编号，不存在时报 NOT_FOUND。可查排队、进度、取消、失败原因、预设、范围、PCM 响度和最终状态。assetRef 为自动收录的素材引用；outputReady 表示有已核验输出，当前会话可用 collect_video_edit_output 与 id 或 taskId 收录；归档优先复用 assetRef，无素材引用时从 path 导入。只观察，不等待、不取消。'],
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
