import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const projectRef = applicationRefSchema.extend({ kind: z.literal('video_edit.project') }).strict()
const input = z.object({ projectRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict().optional(), frame: z.number().int().nonnegative().optional(), assetRef: applicationRefSchema.extend({ kind: z.literal('asset') }).strict().optional() }).strict()
const output = z.object({ resultRef: projectRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: projectRef }), task: z.object({ id: z.string(), state: z.enum(['running', 'completed', 'cancelled', 'failed']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative().optional(), endFrame: z.number().int().positive().optional() }).optional() }).strict()
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
export const collectVideoEditCodeAssetCapability = defineApplicationCapability({
  id: 'collect_video_edit_code_asset', title: '收录可编辑代码素材', description: '将明确代码项目项、代码片段或附加效果的固定源码、原始参数、关键帧和原图片依赖保存为可编辑资产，可在另一剪辑工程调参。失败保留已完成文件，重试只收录。',
  version: 1, domain: 'video_edit', aliases: ['代码素材加入资产库'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'assets:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.project', 'video_edit.item', 'video_edit.clip', 'video_edit.effect', 'video_edit.code_material', 'asset.library'], producesRefs: ['asset'],
  inputSchema: z.object({ projectRef, targetRef: applicationRefSchema.extend({ kind: z.enum(['video_edit.item', 'video_edit.clip', 'video_edit.effect', 'video_edit.code_material']) }).strict(), libraryRef: libraryRef.optional() }).strict(), outputSchema: collectOutput,
  concurrencyKey: 'video_edit_output', resolveConcurrencyKey: parsed => `video_edit:${parsed.projectRef.id}`,
  resolveOperationTargets: parsed => [parsed.projectRef, parsed.targetRef, ...(parsed.libraryRef ? [parsed.libraryRef] : [])], resolveOperationWriteTargets: parsed => [parsed.libraryRef ?? parsed.projectRef],
  control: capabilityControl('execute', ['asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const creativeResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generation.result'), resultRef: ref('generation.result'), outputIndex: z.number().int().nonnegative().max(199) }).strict(),
  z.object({ kind: z.literal('canvas.node'), canvasProjectRef: ref('canvas.project'), nodeRef: ref('canvas.node') }).strict(),
  z.object({ kind: z.literal('image_edit.document'), documentRef: ref('image_edit.document'), revision: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('audio_edit.project'), audioProjectRef: ref('audio_edit.project'), includeProcessing: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('camera_stage.render_task'), taskRef: ref('camera_stage.render_task') }).strict(),
])
const placementInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative(), trackRef: ref('video_edit.track'), durationFrames: z.number().int().positive().optional() }).strict(),
  z.object({ mode: z.literal('replace'), clipRef: ref('video_edit.clip') }).strict(),
])
const clipResultRef = ref('video_edit.clip')
const placeOutput = z.object({ resultRef: clipResultRef, projectRef, assetRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: clipResultRef }) }).strict()
export const placeVideoEditCreativeResultCapability = defineApplicationCapability({
  id: 'place_video_edit_creative_result', title: '把创作结果放入剪辑', description: '把已正式完成的生成结果、画布节点输出、图片编辑文档版本、口播剪辑工程（导出新WAV与SRT）或三维渲染任务结果，加入指定序列轨道的整数帧，或替换明确片段。目标在开始前固定，期间原工程被修改、关闭或取消则不回填；结果先收录到现有资产库并保留原路径，一次撤销即可移除。不会发起新的付费生成。',
  version: 1, domain: 'video_edit', aliases: ['生成结果加入剪辑', '替换剪辑片段', '图片编辑结果回填剪辑', '口播加入剪辑', '三维渲染加入剪辑'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.project', 'video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'generation.result', 'canvas.project', 'canvas.node', 'image_edit.document', 'audio_edit.project', 'camera_stage.render_task'], producesRefs: ['video_edit.clip', 'asset'],
  prerequisites: ['来源必须已经完成并保存为本地文件；口播来源会请用户选择新的 WAV 文件名（同名 SRT 一并写出）。'],
  inputSchema: z.object({ projectRef, sequenceRef: ref('video_edit.sequence'), placement: placementInput, result: creativeResult }).strict(), outputSchema: placeOutput,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.projectRef.id}`,
  resolveOperationTargets: parsed => [parsed.projectRef], resolveOperationWriteTargets: parsed => [parsed.projectRef],
  control: capabilityControl('execute', ['video_edit.clip', 'asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const observeTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('program'), sequenceRef: ref('video_edit.sequence').optional(), frame: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('source'), itemRef: ref('video_edit.item'), timeUs: z.number().int().nonnegative() }).strict(),
])
const observeOutput = z.object({ resultRef: assetRef, projectRef, target: observeTarget, width: z.number().int().positive(), height: z.number().int().positive(), sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), documentRevision: z.number().int().nonnegative(), message: z.string(),
  verification: z.object({ verified: z.boolean(), condition: z.string(), target: assetRef }) }).strict()
export const observeVideoEditFrameCapability = defineApplicationCapability({
  id: 'observe_video_edit_frame', title: '观察剪辑指定画面', description: '按当前工程版本离屏渲染序列指定整数帧的最终合成画面（含代码素材、滤镜、转场与字幕），或项目项源素材指定微秒时间的原始画面，保存为资产库图片并返回assetRef；用 read_application_media 读取图片内容。不改变用户的播放头、选区和节目画面。默认宽度1920，可设256到3840。',
  version: 1, domain: 'video_edit', aliases: ['查看剪辑帧', '取合成帧', '取源帧', '检查画面'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.project', 'video_edit.sequence', 'video_edit.item'], producesRefs: ['asset'],
  successEvidence: ['返回固定工程版本渲染的资产图片；画面内容需经模型读取后才能判断是否符合预期。'],
  failureRecovery: ['帧超出范围或项目项没有画面时按提示修正；渲染队列已满时稍后重试。'],
  inputSchema: z.object({ projectRef, target: observeTarget, maxWidth: z.number().int().min(256).max(3840).optional() }).strict(), outputSchema: observeOutput,
  concurrencyKey: 'video_edit_observe', resolveConcurrencyKey: parsed => `video_edit_observe:${parsed.projectRef.id}`,
  resolveOperationTargets: parsed => [parsed.projectRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.project', 'asset'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'observe', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
export const VIDEO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [...[
  ['save_video_edit', '保存剪辑工程', '将当前修改保存到用户为工程选择的本地文件。失败后只重试保存，不重复修改。'],
  ['undo_video_edit', '撤销剪辑修改', '撤销目标工程的一步手动或助手修改。'],
  ['redo_video_edit', '重做剪辑修改', '恢复目标工程刚撤销的一步修改。'],
  ['split_video_edit', '拆分剪辑片段', '在指定工程帧拆分片段，正确换算源时间并迁移后半段标注。'],
  ['import_video_edit_asset', '引用素材库素材', '从现有素材库引用原媒体或可编辑代码到剪辑工程，不复制原文件。代码生成器保留参数、关键帧和原图片依赖；代码滤镜需要明确目标clipRef并应用到该原片段。'],
  ['export_video_edit', '导出剪辑成片或字幕', '将当前序列快照导出到用户通过本地对话框选择的新MP4（含音轨与烧录字幕），或SRT/WebVTT字幕文件。设置了序列入出点时只导出该半开范围，成片与字幕从入点计时；未设置则导出整条序列。字幕文件写完即核实，视频须查询导出任务。'],
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
})), collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability]
