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
  state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']).describe('interrupted：界面重新加载时正在导出，未完成文件已清理，可用 retryTaskId 按原快照重试。'), progress: z.number().min(0).max(1), range, settings: videoEditExportSettingsSchema,
  path: z.string().optional(), completedAt: z.number().optional(), archived: z.boolean().optional(),
  rangeSource: z.enum(['explicit', 'in-out', 'content']).describe('区间来源：explicit 为调用指定，in-out 为序列入出点，content 为片段、字幕、标记的最远末尾；不加尾部余量。'),
  taskId: z.string().optional(), error: z.string().optional(), notice: z.string().optional(), outputReady: z.boolean(), assetRef: ref('asset').optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(),
}).strict()
const task = z.object({ id: z.string(), state: z.enum(['running', 'completed', 'failed', 'cancelled']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), loudness: videoEditLoudnessSettingsSchema.optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(), notice: z.string().optional() }).strict()
const compactJob = videoEditExportJobSummarySchema.pick({ id: true, documentRef: true, state: true, progress: true, taskId: true, error: true, notice: true, outputReady: true, assetRef: true, completedAt: true, archived: true }).extend({
  resultRef: z.object({ documentRef, taskId: z.string() }).strict(),
})
const queryJob = compactJob.extend({ ...videoEditExportJobSummarySchema.omit({ id: true, documentRef: true, state: true, progress: true, outputReady: true }).partial().shape })
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }).strict(), queue: z.array(videoEditExportJobSummarySchema), task: task.optional() }).strict()
export const videoEditExportTaskInputSchema = z.object({ documentRef, taskId: z.string().min(1).optional() }).strict()
export const videoEditExportQuerySchema = videoEditExportTaskInputSchema.extend({
  detail: z.enum(['compact', 'full']).default('compact').describe('full 展开设置、预设、区间和响度；默认只读状态与结果引用。'),
  activeOnly: z.boolean().default(false).describe('只返回 queued/running，不读取归档历史。'),
  cursor: z.string().min(1).optional().describe('上一页 nextCursor，保持 documentRef、taskId 和 activeOnly 不变。'),
  limit: z.number().int().min(1).max(100).default(50).describe('单页传输预算；不限制历史总数。'),
})
const queryOutput = output.omit({ task: true }).extend({ queue: z.array(queryJob), total: z.number().int().nonnegative(), nextCursor: z.string().nullable() })
const descriptions = {
  export_video_edit: ['导出剪辑成片或字幕', '导出后用 query_video_edit_export 查完成。默认与序列一致；通用实体 video_edit.export_preset 提供预设，批量 exports 每项指定 presetRef/完整 settings，可用 documentRef/sequenceRef 选择原剪辑/序列。完整 settings 不支持则拒绝；预设/缺省设置按设备适配，queue.settings 回读实际值。followSequence 在提交时读取序列值；videoEnabled/audioEnabled 控制画面/声音，sampleRate 为 Hz，wav 为24位PCM；loudness=null 不标准化。captionMode 导出同名字幕，以导出入点为零；独立 srt/vtt 的 subtitleClock 默认 range，可选 sequence。useProxies 只用代理画面、声音用原片；importToProject 导入原项目；addToLibrary 默认 true，需 assets:write，否则设 false 再收录。range 为整数帧半开范围；省略用入出点，无标记则整序列。retryTaskId 按原快照重试未发布文件的失败项或 interrupted 项。'],
  query_video_edit_export: ['查询剪辑导出', '分页读取导出状态、进度、结果引用与必要错误。默认 compact；detail="full" 展开实际 settings、区间、预设和响度。activeOnly=true 只查排队或运行项；历史用 nextCursor 续读，保持筛选条件。taskId 接受 queue.id 或渲染编号，不存在时报 NOT_FOUND。resultRef 可直接作为本工具下一次查询参数；assetRef 可直接跨工作区复用。outputReady 表示已核验输出，当前会话可用 collect_video_edit_output 与 id/taskId 收录。只观察，不等待、不取消。'],
  cancel_video_edit_export: ['取消剪辑导出', 'taskId 指定此剪辑的单项导出（取 queue.id）；省略则取消此剪辑全部未完成项及旧导出。清理未完成文件，保留已发布文件。'],
} as const
export const VIDEO_EDIT_EXPORT_CAPABILITIES = (Object.keys(descriptions) as Array<keyof typeof descriptions>).map(id => defineApplicationCapability<z.infer<typeof videoEditExportInputSchema> | z.infer<typeof videoEditExportQuerySchema> | z.infer<typeof videoEditExportTaskInputSchema>, z.infer<typeof output> | z.infer<typeof queryOutput>>({
  id, title: descriptions[id][0], description: descriptions[id][1], version: 1, domain: 'video_edit', aliases: [descriptions[id][0], '导出抖音竖版和B站横版'],
  readOnly: id === 'query_video_edit_export', dataClasses: ['C1'], permission: id === 'query_video_edit_export' ? 'video_edit:read' : 'video_edit:write',
  idempotent: id !== 'export_video_edit', destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.export_preset'], producesRefs: ['video_edit.document'],
  concurrencyKey: 'video_edit_export', resolveConcurrencyKey: parsed => `video_edit_export:${parsed.documentRef.id}`,
  inputSchema: id === 'export_video_edit' ? videoEditExportInputSchema : id === 'query_video_edit_export' ? videoEditExportQuerySchema : videoEditExportTaskInputSchema, outputSchema: id === 'query_video_edit_export' ? queryOutput : output,
  resolveOperationTargets: parsed => [parsed.documentRef, ...('exports' in parsed ? parsed.exports?.flatMap(value => value.documentRef ? [value.documentRef] : []) ?? [] : [])],
  resolveOperationWriteTargets: parsed => id === 'query_video_edit_export' ? [] : [parsed.documentRef, ...('exports' in parsed ? parsed.exports?.flatMap(value => value.documentRef ? [value.documentRef] : []) ?? [] : [])],
  control: capabilityControl(id === 'query_video_edit_export' ? 'observe' : 'execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'] }),
  summarize: result => result.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [...new Map([result.resultRef, ...result.queue.map(job => job.documentRef)].map(target => [target.id, target])).values()].map(target => ({
    effect: id === 'query_video_edit_export' ? 'observe' as const : 'execute' as const, entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [target], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [],
  })),
}))
