import { z } from 'zod'
import { VIDEO_EDIT_SUBTITLE_CAPABILITIES } from './videoEditSubtitleCapabilities'
import { analyzeVideoEditLumetriCapability } from './videoEditLumetriCapability'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_IN_PLACE_GENERATION_CAPABILITIES } from './videoEditInPlaceGenerationCapabilities'
import { rippleVideoEditClipSpeedCapability } from './videoEditSpeedCapability'
import { VIDEO_EDIT_LOUDNESS_CAPABILITIES } from './videoEditLoudnessCapabilities'
import { videoEditLoudnessSettingsSchema, videoEditLoudnessMeasurementSchema } from '../../../videoEdit/loudness'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const input = z.object({ documentRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict().optional(), frame: z.number().int().nonnegative().optional(), assetRef: applicationRefSchema.extend({ kind: z.literal('asset') }).strict().optional() }).strict()
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }), task: z.object({ id: z.string(), state: z.enum(['running', 'completed', 'cancelled', 'failed']), progress: z.number(), revision: z.number(), startFrame: z.number().int().nonnegative().optional(), endFrame: z.number().int().positive().optional(), loudness: videoEditLoudnessSettingsSchema.optional(), loudnessMeasurement: videoEditLoudnessMeasurementSchema.optional() }).optional() }).strict()
const libraryRef = applicationRefSchema.extend({ kind: z.literal('asset.library') }).strict()
const assetRef = applicationRefSchema.extend({ kind: z.literal('asset') }).strict()
const collectInput = z.object({ documentRef, libraryRef: libraryRef.optional(), kind: z.enum(['export', 'frame']), taskId: z.string().min(1).optional(), frame: z.number().int().nonnegative().optional() }).strict().superRefine((value, context) => {
  if (value.kind === 'export' && (!value.taskId || value.frame !== undefined)) context.addIssue({ code: 'custom', message: '成片收录需要已完成导出taskId，不能指定节目帧。' })
  if (value.kind === 'frame' && value.taskId !== undefined) context.addIssue({ code: 'custom', message: '节目选帧不能指定导出taskId。' })
})
const collectOutput = z.object({ resultRef: assetRef, documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: assetRef }) }).strict()
export const collectVideoEditOutputCapability = defineApplicationCapability({
  id: 'collect_video_edit_output', title: '收录剪辑成片或节目选帧', description: '收录明确已完成导出任务的成片，或将当前真实节目帧保存为新PNG后加入现有资产库；返回assetRef供画布复用。收录失败保留已发布文件，重试不重新导出或出帧。选帧需要当前节目面板可用、已暂停并定位目标帧。',
  version: 1, domain: 'video_edit', aliases: ['成片加入资产库', '选帧加入资产库'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'assets:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.document', 'asset.library'], producesRefs: ['asset'], inputSchema: collectInput,
  outputSchema: collectOutput,
  concurrencyKey: 'video_edit_output', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, ...(parsed.libraryRef ? [parsed.libraryRef] : [])], resolveOperationWriteTargets: parsed => [parsed.libraryRef ?? parsed.documentRef],
  control: capabilityControl('execute', ['asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof collectInput>, result: z.infer<typeof collectOutput>) => [{ effect: 'execute', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
export const collectVideoEditCodeAssetCapability = defineApplicationCapability({
  id: 'collect_video_edit_code_asset', title: '收录可编辑代码素材', description: '将明确代码素材项、代码片段或附加效果的固定源码、原始参数、关键帧和原图片依赖保存为可编辑资产，可在另一剪辑调参。失败保留已完成文件，重试只收录。',
  version: 1, domain: 'video_edit', aliases: ['代码素材加入资产库'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'assets:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.document', 'video_edit.item', 'video_edit.clip', 'video_edit.effect', 'video_edit.code_material', 'asset.library'], producesRefs: ['asset'],
  inputSchema: z.object({ documentRef, targetRef: applicationRefSchema.extend({ kind: z.enum(['video_edit.item', 'video_edit.clip', 'video_edit.effect', 'video_edit.code_material']) }).strict(), libraryRef: libraryRef.optional() }).strict(), outputSchema: collectOutput,
  concurrencyKey: 'video_edit_output', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, parsed.targetRef, ...(parsed.libraryRef ? [parsed.libraryRef] : [])], resolveOperationWriteTargets: parsed => [parsed.libraryRef ?? parsed.documentRef],
  control: capabilityControl('execute', ['asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
// 片段来源只有两种（4.1）：文档（画布结果节点 / 图片文档 / 口播）与生成记录里的第几个结果
const creativeResult = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('document'),
    documentRef: ref('documents.document').describe('来源文档，取自 list_documents。画布、图片文档、口播可以放进剪辑。'),
    nodeRef: ref('canvas.node').optional().describe('画布来源必填：要放进剪辑的结果节点（三维渲染结果也是画布节点）。'),
    includeProcessing: z.boolean().optional().describe('口播来源：导出的剪后声音是否带上声音处理。'),
  }).strict(),
  z.object({ type: z.literal('generation'), resultRef: ref('generation.result'), outputIndex: z.number().int().nonnegative().max(199) }).strict(),
])
const placementInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative(), trackRef: ref('video_edit.track'), durationFrames: z.number().int().positive().optional() }).strict(),
  z.object({ mode: z.literal('replace'), clipRef: ref('video_edit.clip') }).strict(),
])
const clipResultRef = ref('video_edit.clip')
const placeOutput = z.object({ resultRef: clipResultRef, documentRef, assetRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: clipResultRef }) }).strict()
export const placeVideoEditCreativeResultCapability = defineApplicationCapability({
  id: 'place_video_edit_creative_result', title: '把创作结果放入剪辑', description: '把来源放进指定序列轨道的整数帧，或替换明确片段。来源只有两种：文档（画布里已正式完成的结果节点、图片文档的当前版本、口播导出的剪后声音与字幕）或生成记录里的第几个结果。结果复制进剪辑所在项目的“生成结果”再引用，片段记住来源，之后可用 open_video_edit_clip_source 回到来源继续编辑；图片文档放进剪辑后保持链接，保存修改后自动重新渲染。目标在开始前固定，期间原剪辑被修改、关闭或取消则不回填；一次撤销即可移除。不会发起新的付费生成。',
  version: 1, domain: 'video_edit', aliases: ['生成结果加入剪辑', '替换剪辑片段', '图片编辑结果回填剪辑', '口播加入剪辑', '三维渲染加入剪辑'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'generation.result', 'documents.document', 'canvas.node'], producesRefs: ['video_edit.clip', 'asset'],
  prerequisites: ['来源必须已经完成并保存为本地文件；口播来源的剪后声音写进剪辑所在项目的“生成结果”（同名 SRT 一并写出）。'],
  inputSchema: z.object({ documentRef, sequenceRef: ref('video_edit.sequence'), placement: placementInput, result: creativeResult }).strict(), outputSchema: placeOutput,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.clip', 'asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const sourceOutput = z.object({ resultRef: clipResultRef, documentRef, status: z.enum(['opened', 'missing']), sourceType: z.enum(['document', 'generation']), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: clipResultRef }) }).strict()
export const openVideoEditClipSourceCapability = defineApplicationCapability({
  id: 'open_video_edit_clip_source', title: '回到片段来源继续编辑', description: '打开剪辑片段记录的来源：来源文档（画布定位到结果节点、图片文档、口播）以嵌入模式打开，工具命令带显示“返回剪辑 · 项目名”；生成记录则打开生成页并定位。会切换界面，只在用户要求回去修改来源时使用。来源找不到时返回 status=missing，需请用户在剪辑里“重新定位…”。',
  version: 1, domain: 'video_edit', aliases: ['回到来源', '继续编辑来源', '打开片段来源', 'open clip source'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'navigation'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['application.surface'],
  successEvidence: ['来源文档已在对应工具里以嵌入模式打开，或生成页已定位到来源记录。'],
  failureRecovery: ['片段没有记录来源（直接导入的素材）时如实说明；来源找不到时请用户在剪辑里右键片段“回到来源继续编辑”后选择“重新定位…”。'],
  inputSchema: z.object({ documentRef, clipRef: ref('video_edit.clip') }).strict(), outputSchema: sourceOutput,
  concurrencyKey: 'video_edit_navigate', resolveConcurrencyKey: parsed => `video_edit_navigate:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('navigate', ['video_edit.clip', 'application.surface']), summarize: result => result.message,
})
const observeTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('program'), sequenceRef: ref('video_edit.sequence').optional(), frame: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('source'), itemRef: ref('video_edit.item'), timeUs: z.number().int().nonnegative() }).strict(),
])
const observeOutput = z.object({ resultRef: assetRef, documentRef, target: observeTarget, width: z.number().int().positive(), height: z.number().int().positive(), sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), documentRevision: z.number().int().nonnegative(), message: z.string(),
  verification: z.object({ verified: z.boolean(), condition: z.string(), target: assetRef }) }).strict()
export const observeVideoEditFrameCapability = defineApplicationCapability({
  id: 'observe_video_edit_frame', title: '观察剪辑指定画面', description: '按当前剪辑版本离屏渲染序列指定整数帧的最终合成画面（含代码素材、滤镜、转场与字幕），或素材项源素材指定微秒时间的原始画面，保存为资产库图片并返回assetRef；用 read_application_media 读取图片内容。不改变用户的播放头、选区和节目画面。默认宽度1920，可设256到3840。',
  version: 1, domain: 'video_edit', aliases: ['查看剪辑帧', '取合成帧', '取源帧', '检查画面'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.item'], producesRefs: ['asset'],
  successEvidence: ['返回固定剪辑版本渲染的资产图片；画面内容需经模型读取后才能判断是否符合预期。'],
  failureRecovery: ['帧超出范围或素材项没有画面时按提示修正；渲染队列已满时稍后重试。'],
  inputSchema: z.object({ documentRef, target: observeTarget, maxWidth: z.number().int().min(256).max(3840).optional() }).strict(), outputSchema: observeOutput,
  concurrencyKey: 'video_edit_observe', resolveConcurrencyKey: parsed => `video_edit_observe:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.document', 'asset'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'observe', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const trimInput = z.object({
  documentRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict(),
  mode: z.enum(['ripple', 'roll', 'slip', 'slide']), edge: z.enum(['in', 'out']).optional(), frames: z.number().int().min(-108_000).max(108_000).refine(value => value !== 0, '修剪帧数不能为 0。'),
}).strict().superRefine((value, context) => {
  if ((value.mode === 'ripple' || value.mode === 'roll') && !value.edge) context.addIssue({ code: 'custom', path: ['edge'], message: '波纹编辑与滚动编辑需要 edge：in 修剪入点，out 修剪出点。' })
  if ((value.mode === 'slip' || value.mode === 'slide') && value.edge) context.addIssue({ code: 'custom', path: ['edge'], message: '外滑与内滑作用于整个片段，不要传 edge。' })
})
/** PR 修剪工具（4.6）：波纹、滚动、外滑、内滑要按素材余量与相邻片段联动计算，不能用单个属性写入表达。 */
export const trimVideoEditClipCapability = defineApplicationCapability({
  id: 'trim_video_edit_clip', title: '修剪剪辑片段（波纹、滚动、外滑、内滑）',
  description: '按 Premiere 修剪工具修剪片段，链接的音画按链接选择一起修剪，一步撤销。mode：ripple 波纹编辑——改片段一端（edge in 入点／out 出点）的长度，后面同步锁定轨道上的片段跟着前移或后移、不留空隙（frames 正数=该端向右：出点变长，入点剪掉开头）；roll 滚动编辑——移动片段与相邻片段之间的编辑点（edge 指这一片段的哪一端），两段一长一短、总长不变；slip 外滑——位置和长度不变，frames 正数换用播放顺序上更晚的一段（正放是素材里更晚，倒放是素材里更早），负数相反；slide 内滑——内容不变，片段整体右移（正数）或左移，前一段出点与后一段入点跟着让位。超出素材余量或相邻片段时自动收紧到能做到的最大值，回执给出实际帧数。',
  version: 1, domain: 'video_edit', aliases: ['波纹编辑', '滚动编辑', '外滑', '内滑', 'ripple edit', 'roll edit', 'slip', 'slide', '修剪片段'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.document'],
  successEvidence: ['剪辑文件回读与内存一致，回执给出实际修剪的帧数。'],
  failureRecovery: ['已到素材或相邻片段边界时换方向或换片段；轨道锁定时先解锁；会让其他轨道片段重叠时先关闭那条轨道的同步锁定。'],
  inputSchema: trimInput, outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, parsed.clipRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
export const VIDEO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [rippleVideoEditClipSpeedCapability, ...[
  ['save_video_edit', '保存剪辑', '立即把剪辑的当前修改写入它在项目文件夹里的剪辑文件（平时会自动保存）。失败后只重试保存，不重复修改。documentRef 的 id 即剪辑的文档 ID（取自 list_documents）。'],
  ['undo_video_edit', '撤销剪辑修改', '撤销目标剪辑的一步手动或助手修改。'],
  ['redo_video_edit', '重做剪辑修改', '恢复目标剪辑刚撤销的一步修改。'],
  ['split_video_edit', '拆分剪辑片段', '在指定剪辑帧拆分片段，正确换算源时间并迁移后半段标注。'],
  ['import_video_edit_asset', '引用素材库素材', '从现有素材库引用原媒体或可编辑代码到剪辑，不复制原文件。代码生成器保留参数、关键帧和原图片依赖；代码滤镜需要明确目标clipRef并应用到该原片段。'],
  ['export_video_edit', '导出剪辑成片或字幕', '将当前序列快照导出到用户通过本地对话框选择的新MP4（含音轨与烧录字幕），或SRT/WebVTT字幕文件。设置了序列入出点时只导出该半开范围，成片从入点计时；字幕文件默认与成片一致从入点计时（range），要保留序列时间写 subtitleClock=sequence。未设置入出点则导出整条序列。字幕文件写完即核实，视频须查询导出任务。'],
  ['query_video_edit_export', '查询剪辑导出', '查询目标剪辑导出进度和最终状态；启用响度标准化时返回目标设置及编码前整片 PCM 的实际响度、真峰值摘要。'],
  ['cancel_video_edit_export', '取消剪辑导出', '取消目标剪辑正在进行的导出，清理未完成输出。'],
].map(([id, title, description]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'video_edit', aliases: [title], readOnly: id === 'query_video_edit_export', risk: id === 'query_video_edit_export' ? 'R0' : 'R1', dataClasses: ['C1'], permission: id === 'query_video_edit_export' ? 'video_edit:read' : 'video_edit:write', idempotent: id === 'save_video_edit' || id.includes('query'), destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', ...(id === 'import_video_edit_asset' ? ['asset'] : [])], producesRefs: ['video_edit.document'], concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`, resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => id === 'query_video_edit_export' ? [] : [parsed.documentRef], control: capabilityControl(id === 'query_video_edit_export' ? 'observe' : 'execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'] }), inputSchema: id === 'export_video_edit' ? input.extend({ format: z.enum(['mp4', 'srt', 'vtt']).optional(), subtitleClock: z.enum(['sequence', 'range']).optional(), loudness: videoEditLoudnessSettingsSchema.optional() }) : input, outputSchema: output, summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof input>, result: z.infer<typeof output>) => [{
    effect: id === 'query_video_edit_export' ? 'observe' as const : 'execute' as const,
    entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
    verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [],
  }],
})), analyzeVideoEditLumetriCapability, collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability, openVideoEditClipSourceCapability, trimVideoEditClipCapability, ...VIDEO_EDIT_IN_PLACE_GENERATION_CAPABILITIES, ...VIDEO_EDIT_SUBTITLE_CAPABILITIES, ...VIDEO_EDIT_LOUDNESS_CAPABILITIES]
