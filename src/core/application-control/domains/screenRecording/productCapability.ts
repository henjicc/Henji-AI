import { z } from 'zod'
import { recordingProductKindSchema } from '../../../screenRecording/products'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

export const recordingExportRefSchema = z.object({ kind: z.literal('screen_recording.export'), id: z.string().uuid() }).strict()
export const recordingProductInputSchema = z.object({
  sessionRef: z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict(),
  product: recordingProductKindSchema.describe('steps: Markdown/HTML 配图；gif: 每步动图；bug_report: 步骤、出错帧与可关联的脱敏日志；image_document: 每步一份可编辑多图层图片文档'),
  stepIds: z.array(z.string().min(1)).min(1).max(100).optional().describe('省略为全部步骤，每批最多 100 步；缺陷报告建议只选出错步骤'),
  destination: canvasDownloadDestinationSchema.optional().describe('已配置的快速下载或预设目录；省略使用用户导出目录。图片文档使用正式草稿容器'),
}).strict()
export const exportRecordingProductCapability = defineApplicationCapability({
  id: 'export_screen_recording_product', version: 1, domain: 'screen_recording', title: '导出录制产物',
  description: '从已停止或恢复会话生成图文步骤、单步 GIF、缺陷报告或多图层图片文档。先有理解步骤（understand_screen_recording，不需付费转写）。画面复用成片合成：自动推近、光标、点击和已确认打码；未确认隐私候选不生效，请先确认后导出。每步 GIF 最多前 15 秒、10fps、宽 640；被截短会明确提示。缺陷报告取步骤末帧，只有明确录制时钟关联时才包含本应用脱敏日志，不抓其他软件日志。输出到用户目录中新建子目录，不覆盖原文件。图片文档截图、标题和说明为独立图层，可用 open_document 进入图片编辑。后台执行不切页，不收费。返回导出引用，通用 list/read screen_recording.export 可读状态、文件名、步骤和图片文档引用（运行期保存结果，文件永久保留）；取消用 cancel_screen_recording_export，不重放已完成输出。多画幅视频继续用 generate_screen_recording_movie 与 export_video_edit。',
  aliases: ['录屏多产物', '图文教程', '单步动图', '录屏缺陷报告', 'recording export'],
  readOnly: false, dataClasses: ['C1'], permission: 'screen_recording:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording_export',
  inputSchema: recordingProductInputSchema,
  outputSchema: z.object({ resultRef: recordingExportRefSchema, state: z.enum(['completed', 'cancelled', 'failed']), files: z.array(z.string()), documentRefs: z.array(z.object({ kind: z.literal('documents.document'), id: z.string() }).strict()), warnings: z.array(z.string()), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.export', 'documents.document'],
  resolveOperationTargets: input => [input.sessionRef], resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'screen_recording.export', id: `pending:${operationId}` }],
  resolveConcurrencyKey: input => `screen_recording_export:${input.sessionRef.id}`,
  control: capabilityControl('execute', ['screen_recording.export', 'documents.document'], { cancelable: true }),
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['screen_recording.export', 'documents.document'], propertyIds: [], targetRefs: [output.resultRef, ...output.documentRefs], count: 1 + output.documentRefs.length, verified: output.verified, evidence: output.verified ? ['输出已逐项回读核对。'] : [] }],
  summarize: output => `已${output.state === 'completed' ? '导出' : '停止'} ${output.files.length} 个文件、${output.documentRefs.length} 份图片文档。${output.warnings.join(' ')}`,
})
export const cancelRecordingExportCapability = defineApplicationCapability({
  id: 'cancel_screen_recording_export', version: 1, domain: 'screen_recording', title: '取消录制产物导出', description: '取消明确的运行中导出，等待渲染和编码释放；已完成的文件与图片文档保留，可通用读取导出引用核对。', aliases: ['取消录屏导出'],
  readOnly: false, dataClasses: ['C1'], permission: 'screen_recording:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording_export_cancel',
  inputSchema: z.object({ exportRef: recordingExportRefSchema }).strict(), outputSchema: z.object({ resultRef: recordingExportRefSchema, verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.export'], producesRefs: ['screen_recording.export'], resolveOperationTargets: input => [input.exportRef], control: capabilityControl('execute', ['screen_recording.export']), summarize: () => '导出已停止，完成的输出保留。',
})
