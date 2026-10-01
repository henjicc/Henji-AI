import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const projectRef = applicationRefSchema.extend({ kind: z.literal('video_edit.project') }).strict()
const input = z.object({ projectRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict().optional(), frame: z.number().int().nonnegative().optional(), assetRef: applicationRefSchema.extend({ kind: z.literal('asset') }).strict().optional() }).strict()
const output = z.object({ resultRef: projectRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: projectRef }), task: z.object({ id: z.string(), state: z.enum(['running', 'completed', 'cancelled', 'failed']), progress: z.number(), revision: z.number() }).optional() }).strict()
const libraryRef = applicationRefSchema.extend({ kind: z.literal('asset.library') }).strict()
const assetRef = applicationRefSchema.extend({ kind: z.literal('asset') }).strict()
const collectInput = z.object({ projectRef, libraryRef: libraryRef.optional(), kind: z.enum(['export', 'frame']), taskId: z.string().min(1).optional(), frame: z.number().int().nonnegative().optional() }).strict().superRefine((value, context) => {
  if (value.kind === 'export' && (!value.taskId || value.frame !== undefined)) context.addIssue({ code: 'custom', message: '成片收录需要已完成导出taskId，不能指定节目帧。' })
  if (value.kind === 'frame' && value.taskId !== undefined) context.addIssue({ code: 'custom', message: '节目选帧不能指定导出taskId。' })
})
const collectOutput = z.object({ resultRef: assetRef, projectRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: assetRef }) }).strict()
export const collectVideoEditOutputCapability = defineApplicationCapability({
  id: 'collect_video_edit_output', title: '收录剪辑成片或节目选帧', description: '收录明确已完成导出任务的成片，或将当前真实节目帧保存为新PNG后加入现有资产库；返回assetRef供画布复用。收录失败保留已发布文件，重试不重新导出或出帧。选帧需要当前节目面板可用、已暂停并定位目标帧。',
  version: 1, domain: 'video_edit', aliases: ['成片加入资产库', '选帧加入资产库'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'assets:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.project', 'asset.library'], producesRefs: ['asset'], inputSchema: collectInput,
  outputSchema: collectOutput,
  concurrencyKey: 'video_edit_output', resolveConcurrencyKey: parsed => `video_edit:${parsed.projectRef.id}`,
  resolveOperationTargets: parsed => [parsed.projectRef, ...(parsed.libraryRef ? [parsed.libraryRef] : [])], resolveOperationWriteTargets: parsed => [parsed.libraryRef ?? parsed.projectRef],
  control: capabilityControl('execute', ['asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof collectInput>, result: z.infer<typeof collectOutput>) => [{ effect: 'execute', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
export const VIDEO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [...[
  ['save_video_edit', '保存剪辑工程', '将当前修改保存到用户为工程选择的本地文件。失败后只重试保存，不重复修改。'],
  ['undo_video_edit', '撤销剪辑修改', '撤销目标工程的一步手动或助手修改。'],
  ['redo_video_edit', '重做剪辑修改', '恢复目标工程刚撤销的一步修改。'],
  ['split_video_edit', '拆分剪辑片段', '在指定工程帧拆分片段，正确换算源时间并迁移后半段标注。'],
  ['import_video_edit_asset', '引用素材库素材', '从现有素材库引用原文件到剪辑工程，不复制文件。'],
  ['export_video_edit', '导出剪辑成片或字幕', '将当前序列快照导出到用户通过本地对话框选择的新MP4（含音轨与烧录字幕），或SRT/WebVTT字幕文件。字幕文件写完即核实，视频须查询导出任务。'],
  ['query_video_edit_export', '查询剪辑导出', '查询目标工程导出进度和最终状态。'],
  ['cancel_video_edit_export', '取消剪辑导出', '取消目标工程正在进行的导出，清理未完成输出。'],
].map(([id, title, description]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'video_edit', aliases: [title], readOnly: id === 'query_video_edit_export', risk: id === 'query_video_edit_export' ? 'R0' : 'R1', dataClasses: ['C1'], permission: id === 'query_video_edit_export' ? 'video_edit:read' : 'video_edit:write', idempotent: id === 'save_video_edit' || id.includes('query'), destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.project', ...(id === 'import_video_edit_asset' ? ['asset'] : [])], producesRefs: ['video_edit.project'], concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.projectRef.id}`, resolveOperationTargets: parsed => [parsed.projectRef], resolveOperationWriteTargets: parsed => id === 'query_video_edit_export' ? [] : [parsed.projectRef], control: capabilityControl(id === 'query_video_edit_export' ? 'observe' : 'execute', ['video_edit.project'], { cancelable: true, revisionScopes: ['video_edit'] }), inputSchema: id === 'export_video_edit' ? input.extend({ format: z.enum(['mp4', 'srt', 'vtt']).optional() }) : input, outputSchema: output, summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof input>, result: z.infer<typeof output>) => [{
    effect: id === 'query_video_edit_export' ? 'observe' as const : 'execute' as const,
    entityTypes: ['video_edit.project'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
    verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [],
  }],
})), collectVideoEditOutputCapability]
