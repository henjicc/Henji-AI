import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditReframeSettingsSchema, videoEditReframeSizeSchema } from '../../../videoEdit/reframe'
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence'); const clipRef = ref('video_edit.clip')
const input = z.object({
  documentRef, sequenceRef: sequenceRef.optional().describe('复制此序列并生成目标画幅的新序列，返回新 sequenceRef。与 clipRef 二选一。'),
  clipRef: clipRef.optional().describe('仅重构原片段，使用其所属序列的画幅，不复制序列。与 sequenceRef 二选一。'),
  targetSize: videoEditReframeSizeSchema.default({ width: 1080, height: 1920 }), name: z.string().trim().min(1).max(200).optional(),
  settings: videoEditReframeSettingsSchema.default({ motion: 'default', attention: 'auto' }),
  trackerBindings: z.array(z.object({ clipRef, trackerRef: ref('video_edit.tracker') }).strict()).max(500).default([]),
  exportPresetRef: ref('video_edit.export_preset').optional().describe('可选：成功保存后用已有视频预设加入导出队列，需用户选输出文件；提交不等于编码完成，随后 query_video_edit_export。'),
}).strict().refine(value => Boolean(value.sequenceRef) !== Boolean(value.clipRef), 'sequenceRef 与 clipRef 必须二选一。')
const output = z.object({ resultRef: sequenceRef, documentRef, clipRefs: z.array(clipRef), created: z.boolean(), missingFrames: z.number().int().nonnegative(), faceFrames: z.number().int().nonnegative(), exportJobIds: z.array(z.string()), exportIssue: z.string().optional(), message: z.string(), verified: z.boolean() }).strict()
export const reframeVideoEditCapability = defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id: 'auto_reframe_video_edit', title: '自动重构序列或片段画幅',
  description: '把横版剪辑做成抖音竖版等画幅：sequenceRef 复制序列，默认 1080×1920（9:16）；1:1 用1080×1080，4:5 用1080×1350，16:9 用1920×1080，自定义宽高16–7680且总像素不超过7680×4320，横竖均支持8K。clipRef 对单个原视频在所属序列画幅内重构。motion slow/default/fast 表示慢/默认/快运动跟随；attention auto 优先人物，装不下则最大人脸，person 人物，face 最大人脸，tracker 跟随 trackerBindings 指定的已完成形状/物体框跟踪器。复用本地分析并生成位置/必要缩放关键帧，镜头切点重置平滑，无检测时保持构图且结果提示检查。重新生成只替换未编辑的自动重构点，保留手动点，同帧手动优先；手动运动冲突、主体装不下或缩放超过4倍时整批拒绝，建议更宽画幅/更小关注框。一步撤销；不嵌套、不付费，不自动切页。返回新序列稳定引用供现有导出能力消费；exportPresetRef 可直接入队，取消文件选择或入队失败仍保留已生成序列。',
  version: 1, domain: 'video_edit', aliases: ['自动重构序列', '自动重构效果', '横版变竖版', '抖音竖版', 'auto reframe'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip', 'video_edit.tracker', 'video_edit.export_preset'], producesRefs: ['video_edit.sequence', 'video_edit.clip'],
  inputSchema: input, outputSchema: output, concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`,
  resolveOperationTargets: value => [value.documentRef, ...(value.sequenceRef ? [value.sequenceRef] : []), ...(value.clipRef ? [value.clipRef] : []), ...value.trackerBindings.flatMap(binding => [binding.clipRef, binding.trackerRef]), ...(value.exportPresetRef ? [value.exportPresetRef] : [])],
  resolveOperationWriteTargets: value => [value.documentRef, value.sequenceRef ?? value.clipRef!],
  control: capabilityControl('execute', ['video_edit.sequence', 'video_edit.clip'], { propertyIds: ['video_edit.clip.x.keyframes', 'video_edit.clip.y.keyframes', 'video_edit.clip.scale.keyframes'], cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'execute', entityTypes: ['video_edit.document'] }] }),
  summarize: value => value.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, value) => [{ effect: 'execute' as const, entityTypes: ['video_edit.sequence', 'video_edit.clip'], propertyIds: ['video_edit.clip.x.keyframes', 'video_edit.clip.y.keyframes', 'video_edit.clip.scale.keyframes'], targetRefs: [value.resultRef, ...value.clipRefs], count: value.clipRefs.length, verified: value.verified, evidence: value.verified ? ['已从保存后的剪辑核对目标序列和运动关键帧。'] : [] }, ...(value.exportJobIds.length ? [{ effect: 'execute' as const, entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [value.documentRef], count: value.exportJobIds.length, verified: true, evidence: ['已提交到正式导出队列；尚未宣称成片完成。'] }] : [])],
})
