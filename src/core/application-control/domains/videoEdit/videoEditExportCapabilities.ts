import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditLoudnessSettingsSchema, videoEditLoudnessMeasurementSchema } from '../../../videoEdit/loudness'
import { videoEditExportSettingsSchema } from '../../../videoEdit/exportPresets'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const range = z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().refine(value => value.endFrame > value.startFrame, '出点必须晚于入点。')
const item = z.object({ documentRef: documentRef.optional(), sequenceRef: ref('video_edit.sequence').optional(), presetRef: ref('video_edit.export_preset'), fit: z.enum(['fit', 'fill', 'letterbox']).optional(), range: range.optional() }).strict()
export const videoEditExportInputSchema = z.object({ documentRef, format: z.enum(['mp4', 'srt', 'vtt']).optional(), subtitleClock: z.enum(['sequence', 'range']).optional(), loudness: videoEditLoudnessSettingsSchema.optional(), exports: z.array(item).min(1).optional(), retryTaskId: z.string().min(1).optional() }).strict().superRefine((value, ctx) => {
  if (value.exports && (value.retryTaskId || value.format || value.loudness || value.subtitleClock)) ctx.addIssue({ code: 'custom', message: '批量 exports 已包含预设声音与格式设置，不能混用旧格式、响度、字幕时间或重试参数。' })
  if (value.retryTaskId && (value.format || value.loudness || value.subtitleClock)) ctx.addIssue({ code: 'custom', message: '重试使用原快照与设置，不可同时更改格式或响度。' })
  if (value.subtitleClock && value.format !== 'srt' && value.format !== 'vtt') ctx.addIssue({ code: 'custom', message: 'subtitleClock 只用于字幕文件。' })
})
export const videoEditExportJobSummarySchema = z.object({
  id: z.string(), documentRef, sequenceRef: ref('video_edit.sequence'), name: z.string(), presetName: z.string(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().min(0).max(1), range, settings: videoEditExportSettingsSchema,
  taskId: z.string().optional(), error: z.string().optional(), outputReady: z.boolean(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional(),
}).strict()
const task = z.object({ id: z.string(), state: z.enum(['running', 'completed', 'failed', 'cancelled']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), loudness: videoEditLoudnessSettingsSchema.optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional() }).strict()
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }).strict(), queue: z.array(videoEditExportJobSummarySchema), task: task.optional() }).strict()
export const videoEditExportQuerySchema = z.object({ documentRef, taskId: z.string().min(1).optional() }).strict()
const descriptions = {
  export_video_edit: ['导出剪辑成片或字幕', '按平台预设一次导出多份：先用通用实体列出/读取 video_edit.export_preset，再在 exports 中提交 presetRef，sequenceRef 可指定不同序列，documentRef 可指定已打开的另一剪辑。range 为序列整数帧的半开入出点；省略时用该序列入出点，无标记则整条序列。fit=适合保留全画面，fill=中心裁切铺满，letterbox=留黑边。用户本地对话框选择每项新文件；全部路径确认后一次进入后台顺序队列，不切页。提交不等于完成，query_video_edit_export 回读；retryTaskId 只重试未发布文件的失败项。旧 format=mp4/srt/vtt 保留；字幕 subtitleClock 默认 range，sequence 保留序列时间。'],
  query_video_edit_export: ['查询剪辑导出', '读取此剪辑的全部导出项：排队、进度、取消、失败原因、预设、范围、PCM 响度和最终状态。outputReady 表示有已核验输出，可用 collect_video_edit_output 与 id 或 taskId 收录。只观察，不等待、不取消。'],
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
