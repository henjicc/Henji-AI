import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'
import { VIDEO_EDIT_MULTICAM_CAPABILITIES } from './videoEditMulticamCapabilities'
import { VIDEO_EDIT_STYLE_KIT_CAPABILITIES } from './videoEditStyleKitCapabilities'
import { VIDEO_EDIT_TITLE_TEMPLATE_CAPABILITIES } from './videoEditTitleTemplateCapabilities'
import { generateVideoEditProxyCapability } from './videoEditProxyCapability'
import { reframeVideoEditCapability } from './videoEditReframeCapability'
import { z } from 'zod'
import { VIDEO_EDIT_TEXT_CAPABILITIES, detectVideoEditTextSilenceCapability } from './videoEditTextCapabilities'
import { nestVideoEditClipsCapability } from './videoEditNestCapability'
import { VIDEO_EDIT_EXPORT_CAPABILITIES } from './videoEditExportCapabilities'
import { VIDEO_EDIT_WORKSPACE_TRANSFER_CAPABILITIES } from './videoEditWorkspaceTransferCapabilities'
import { VIDEO_EDIT_SUBTITLE_CAPABILITIES } from './videoEditSubtitleCapabilities'
import { analyzeVideoEditLumetriCapability } from './videoEditLumetriCapability'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_IN_PLACE_GENERATION_CAPABILITIES } from './videoEditInPlaceGenerationCapabilities'
import { rippleVideoEditClipSpeedCapability } from './videoEditSpeedCapability'
import { VIDEO_EDIT_LOUDNESS_CAPABILITIES } from './videoEditLoudnessCapabilities'
import { VIDEO_EDIT_SCENE_CAPABILITIES } from './videoEditSceneCapabilities'
import { generateVideoEditAudioDuckingCapability } from './videoEditAudioDuckingCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const input = z.object({ documentRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict().optional(), frame: z.number().int().nonnegative().optional(), assetRef: applicationRefSchema.extend({ kind: z.literal('asset') }).strict().optional() }).strict()
const output = z.object({ resultRef: documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }) }).strict()
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
  z.object({ type: z.literal('generation'), resultRef: ref('generation.result'), outputIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ type: z.literal('asset'), assetRef }).strict(),
])
const placementInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative(), trackRef: ref('video_edit.track').optional(), newTrack: z.enum(['video', 'audio']).optional(), durationFrames: z.number().int().positive().optional() }).strict(),
  z.object({ mode: z.literal('replace'), clipRef: ref('video_edit.clip') }).strict(),
  z.object({ mode: z.literal('library') }).strict(),
  z.object({ mode: z.enum(['insert', 'overwrite']), frame: z.number().int().nonnegative(), trackRef: ref('video_edit.track'), durationFrames: z.number().int().positive().optional() }).strict(),
]).superRefine((value, context) => { if (value.mode === 'add' && (value.trackRef === undefined) === (value.newTrack === undefined)) context.addIssue({ code: 'custom', message: 'add 请指定 trackRef 或 newTrack 之一。' }) })
const clipResultRef = ref('video_edit.clip')
const placedResultRef = applicationRefSchema.extend({ kind: z.enum(['video_edit.clip', 'video_edit.item']) }).strict()
const placeOutput = z.object({ resultRef: placedResultRef, documentRef, assetRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: placedResultRef }) }).strict()
export const placeVideoEditCreativeResultCapability = defineApplicationCapability({
  id: 'place_video_edit_creative_result', title: '把创作结果放入剪辑', description: '把画布结果节点、图片文档、口播剪后声音、生成历史第几个结果或资产库图片/视频/声音，送到明确的剪辑文档和序列。placement.mode：library 只进素材面板并返回 item 引用；overwrite 在指定轨道整数帧覆盖相交部分；insert 在指定帧插入并按同步锁定后移；add 加到空轨道；replace 替换明确片段。durationFrames 为序列帧数，图片编辑回填当前帧用 overwrite 或上方空轨 add，时长 1。结果复制进目标项目的“生成结果”，文档/生成来源片段可回到来源；图片文档片段保持链接。目标在开始前固定，原剪辑在准备期间修改、关闭或取消则拒绝；一次撤销恢复。不会发起新的付费生成。图片编辑当前帧回填必须携带 edit_video_edit_program_frame 返回的 frameEditSessionRef 与 returnPlacement，沿原会话冻结目标，原剪辑改动或关闭后拒绝迟到回填。',
  version: 1, domain: 'video_edit', aliases: ['生成结果加入剪辑', '替换剪辑片段', '图片编辑结果回填剪辑', '口播加入剪辑', '三维渲染加入剪辑'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'assets'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'generation.result', 'documents.document', 'canvas.node', 'asset'], producesRefs: ['video_edit.clip', 'video_edit.item', 'asset'],
  prerequisites: ['来源必须已经完成并保存为本地文件；口播来源的剪后声音写进剪辑所在项目的“生成结果”（同名 SRT 一并写出）。'],
  inputSchema: z.object({ documentRef, sequenceRef: ref('video_edit.sequence'), placement: placementInput, result: creativeResult, frameEditSessionRef: z.string().min(1).max(200).optional() }).strict(), outputSchema: placeOutput,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.clip', 'video_edit.item', 'asset'], { cancelable: true, revisionScopes: ['video_edit', 'assets'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: [result.resultRef.kind], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
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
  id: 'observe_video_edit_frame', title: '观察剪辑指定画面', description: '按当前剪辑版本离屏渲染序列指定整数帧的最终合成画面（含代码素材、滤镜、转场与字幕），或素材项源素材指定微秒时间的原始画面，保存为资产库图片并返回assetRef；用 read_application_media 读取图片内容。不改变用户的播放头、选区和节目画面。默认宽度1920，可设256到3840。overlayAnnotations=true叠加当前帧未关闭的标注及列表编号；annotationIds指定标注（包括已通过）；cropAnnotationId按点/矩形/笔画/元素region裁切放大。时间段没有画面区域，不能裁切。highlightElement={clipRef,elementId}可高亮指定当前帧代码元素；标注与元素选项只支持program帧。',
  version: 1, domain: 'video_edit', aliases: ['查看剪辑帧', '取合成帧', '取源帧', '检查画面'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.item'], producesRefs: ['asset'],
  successEvidence: ['返回固定剪辑版本渲染的资产图片；画面内容需经模型读取后才能判断是否符合预期。'],
  failureRecovery: ['帧超出范围或素材项没有画面时按提示修正；渲染队列已满时稍后重试。'],
  inputSchema: z.object({ documentRef, target: observeTarget, maxWidth: z.number().int().min(256).max(3840).optional(), overlayAnnotations: z.boolean().optional(), annotationIds: z.array(z.string().min(1)).optional(), cropAnnotationId: z.string().min(1).optional(), highlightElement: z.object({ clipRef, elementId: z.string().min(1) }).strict().optional() }).strict(), outputSchema: observeOutput,
  concurrencyKey: 'video_edit_observe', resolveConcurrencyKey: parsed => `video_edit_observe:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.document', 'asset'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'observe', entityTypes: ['asset'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
const trimInput = z.object({
  documentRef, clipRef: applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict(),
  mode: z.enum(['ripple', 'roll', 'slip', 'slide']), edge: z.enum(['in', 'out']).optional(), frames: z.number().int().min(-VIDEO_EDIT_MAX_SEQUENCE_FRAMES).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).refine(value => value !== 0, '修剪帧数不能为 0。'),
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
export const VIDEO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [...VIDEO_EDIT_TITLE_TEMPLATE_CAPABILITIES, ...VIDEO_EDIT_MULTICAM_CAPABILITIES, nestVideoEditClipsCapability, reframeVideoEditCapability, generateVideoEditAudioDuckingCapability, rippleVideoEditClipSpeedCapability, ...[
  ['save_video_edit', '保存剪辑', '立即把剪辑的当前修改写入它在项目文件夹里的剪辑文件（平时会自动保存）。失败后只重试保存，不重复修改。documentRef 的 id 即剪辑的文档 ID（取自 list_documents）。'],
  ['undo_video_edit', '撤销剪辑修改', '撤销目标剪辑的一步手动或助手修改。'],
  ['redo_video_edit', '重做剪辑修改', '恢复目标剪辑刚撤销的一步修改。'],
  ['split_video_edit', '拆分剪辑片段', '在指定剪辑帧拆分片段，正确换算源时间并迁移后半段标注。'],
  ['import_video_edit_asset', '引用素材库素材', '从现有素材库引用原媒体或可编辑代码到剪辑，不复制原文件。代码生成器保留参数、关键帧和原图片依赖；代码滤镜需要明确目标clipRef并应用到该原片段。'],
  ['import_video_edit_folder', '导入文件夹素材', '请用户通过本机文件夹选择窗口选择目录，递归导入任意层级的子文件夹并建立同名素材箱，引用原媒体、不复制原文件。没有文件数量限制；读不出的文件、不支持的格式和目录回环跳过汇总。导入队列与进度可读取 video_edit.document.media_import，追加请求排队，每个请求一步撤销。目录立即建素材箱，素材分批出现；取消整个队列保留已完成部分、清理本次新建的空素材箱。按剪辑设置保留目录层级或平铺，同一父素材箱下复用来源目录对应的素材箱，默认跳过重复文件、只补入新增文件。不要提供原始路径。'],
].map(([id, title, description]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'video_edit', aliases: [title], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: id === 'save_video_edit', destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: id === 'import_video_edit_folder', requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', ...(id === 'import_video_edit_asset' ? ['asset'] : [])], producesRefs: ['video_edit.document'], concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`, resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => [parsed.documentRef], control: capabilityControl('execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'] }), inputSchema: input, outputSchema: output, summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof input>, result: z.infer<typeof output>) => [{
    effect: 'execute' as const,
    entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
    verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [],
  }],
})), ...VIDEO_EDIT_STYLE_KIT_CAPABILITIES, ...VIDEO_EDIT_EXPORT_CAPABILITIES, ...VIDEO_EDIT_WORKSPACE_TRANSFER_CAPABILITIES, analyzeVideoEditLumetriCapability, collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability, openVideoEditClipSourceCapability, trimVideoEditClipCapability, ...VIDEO_EDIT_IN_PLACE_GENERATION_CAPABILITIES, ...VIDEO_EDIT_TEXT_CAPABILITIES, detectVideoEditTextSilenceCapability, ...VIDEO_EDIT_SUBTITLE_CAPABILITIES, ...VIDEO_EDIT_LOUDNESS_CAPABILITIES, ...VIDEO_EDIT_SCENE_CAPABILITIES, generateVideoEditProxyCapability]
