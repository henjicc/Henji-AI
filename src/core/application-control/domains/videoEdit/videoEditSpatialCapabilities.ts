import { z } from 'zod'
import { applicationRefSchema } from '../../identifiers'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'
import { spatialCameraFields, spatialVec3Schema, spatialBoundsSchema } from '../../../videoEdit/spatialSchema'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'), sequenceRef = ref('video_edit.sequence'), clipRef = ref('video_edit.clip')
const frame = z.number().int().nonnegative()
const range = z.tuple([frame, frame]).refine(([start, end]) => end > start, 'range 终帧须大于起帧，且包含两个端点。')
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clip'), targetRef: clipRef }).strict(),
  z.object({ kind: z.literal('point'), point: spatialVec3Schema }).strict(),
  z.object({ kind: z.literal('bounds'), bounds: spatialBoundsSchema }).strict(),
])
const focus = z.union([targetSchema, z.object({ kind: z.literal('distance'), distance: z.number().finite().positive() }).strict()])
const hold = <T extends z.ZodType>(schema: T) => z.array(z.object({ time: frame, value: schema.nullable(), interpolation: z.literal('hold') }).strict())
/** 公共目标使用稳定引用，存储目标仍由领域转换成同一序列内 clipId。 */
const cameraInput = z.object({
  ...spatialCameraFields,
  framing: z.object({ target: targetSchema, heightFraction: z.number().finite().positive(), perspective: z.number().finite().optional() }).strict().optional(),
  aim: targetSchema.optional(), focus: focus.optional(),
  bindings: z.object({ framing: hold(targetSchema).optional(), aim: hold(targetSchema).optional(), focus: hold(focus).optional() }).strict().optional(),
  optics: z.object({ focalLengthMm: z.number().finite().positive() }).strict().optional(),
}).strict()
/** 事务的期望值与落盘读回共用规范化：光学输入只转换成同一透视量，不保存副本。 */
export const videoEditSpatialCameraInputSchema = cameraInput.superRefine((input, ctx) => {
  const perspective = input.framing?.perspective ?? input.perspective
  if (input.framing?.perspective !== undefined && input.perspective !== undefined && input.framing.perspective !== input.perspective) ctx.addIssue({ code: 'custom', path: ['framing', 'perspective'], message: '取景透视量与相机透视量须一致。' })
  if (input.optics && (perspective !== undefined && perspective !== Math.log2(input.optics.focalLengthMm / 80) || input.curves?.perspective?.length)) ctx.addIssue({ code: 'custom', path: ['optics'], message: '精确焦距写入请省略透视量与透视曲线。' })
}).overwrite(input => {
  const target = (value: z.infer<typeof focus>): z.infer<typeof focus> => value.kind === 'clip' ? { kind: 'clip', targetRef: { kind: 'video_edit.clip', id: value.targetRef.id } } : value
  const result: z.infer<typeof cameraInput> = { ...input }
  if (input.framing) result.framing = { target: target(input.framing.target) as z.infer<typeof targetSchema>, heightFraction: input.framing.heightFraction }
  const perspective = input.optics ? Math.log2(input.optics.focalLengthMm / 80) : input.framing?.perspective ?? input.perspective
  if (perspective !== undefined) result.perspective = perspective
  delete result.optics
  if (input.aim) result.aim = target(input.aim) as z.infer<typeof targetSchema>
  if (input.focus) result.focus = target(input.focus)
  if (input.bindings) result.bindings = {
    ...(input.bindings.framing ? { framing: input.bindings.framing.map(point => ({ ...point, value: point.value ? target(point.value) as z.infer<typeof targetSchema> : null })) } : {}),
    ...(input.bindings.aim ? { aim: input.bindings.aim.map(point => ({ ...point, value: point.value ? target(point.value) as z.infer<typeof targetSchema> : null })) } : {}),
    ...(input.bindings.focus ? { focus: input.bindings.focus.map(point => ({ ...point, value: point.value ? target(point.value) : null })) } : {}),
  }
  return result
})
export type VideoEditSpatialCameraInput = z.infer<typeof videoEditSpatialCameraInputSchema>
const facts = z.array(z.object({ code: z.string(), clipRefs: z.array(clipRef), sequenceFrame: z.number().finite().nonnegative(), message: z.string(), values: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])) }).strict())
const common = { documentRef, sequenceRef, clipRefs: z.array(clipRef).min(1), focusRef: clipRef }
const result = z.object({ documentRef, sequenceRef, changedRefs: z.array(applicationRefSchema), achievedParallaxRatio: z.number().finite().min(1), maxProjectionErrorPx: z.number().finite().nonnegative(), facts, saved: z.boolean(), undoRef: documentRef.describe('此文档的同一剪辑历史；传给 undo_video_edit.documentRef 撤销最近一步，后续修改按历史顺序撤销。'), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict(), message: z.string() }).strict()
const writing = {
  version: 1, domain: 'video_edit' as const, readOnly: false, dataClasses: ['C1' as const], idempotent: false, destructive: false,
  timeoutMs: 120_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.sequence', 'video_edit.clip'],
  outputSchema: result, control: capabilityControl('update', ['video_edit.clip', 'video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }),
  concurrencyKey: 'video_edit',
}
export const arrangeVideoEditDepthCapability = defineApplicationCapability({
  ...writing, id: 'arrange_video_edit_depth', title: '拉开景深层次', aliases: ['景深层次', '视差', 'depth layout'],
  description: '按 clipRefs 从远到近拉开层次。parallaxRatio 为最近层与最远层的视差比（至少1），focusRef 保持参考层距离。referenceFrame 是序列帧；range 可选，为包含两端的过渡帧。保持参考构图并报告实际误差；动画片段请提供 range。一步撤销。',
  inputSchema: z.object({ ...common, referenceFrame: frame, parallaxRatio: z.number().finite().min(1), range: range.optional() }).strict(),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, ...input.clipRefs, input.focusRef], resolveOperationWriteTargets: input => [input.documentRef],
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['video_edit.clip', 'video_edit.sequence'], propertyIds: [], targetRefs: output.changedRefs, count: output.changedRefs.length, verified: output.verification.verified, evidence: [output.verification.condition] }], summarize: output => output.message,
})
export const transitionVideoEditSpaceCapability = defineApplicationCapability({
  ...writing, id: 'transition_video_edit_space', title: '展开或压平空间', aliases: ['展开空间', '压平空间', 'space transition'],
  description: '在包含两端的序列帧 range 内连续展开或压平所选画面层。expand 从规范平面起步，按 parallaxRatio 拉开远近，perspective 控制推拉透视并持久保持主体取景；flatten 尾点空间四值、镜头偏移、旋转、透视和虚化归零并解除绑定。保留区间外动画；不改作者场景对象。一步撤销。',
  inputSchema: z.object({ ...common, mode: z.enum(['expand', 'flatten']), range, parallaxRatio: z.number().finite().min(1).optional(), perspective: z.number().finite().optional() }).strict().superRefine((input, ctx) => {
    for (const key of ['parallaxRatio', 'perspective'] as const) {
      if (input.mode === 'expand' && input[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `展开必须提供 ${key}。` })
      if (input.mode === 'flatten' && input[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: `压平不接受 ${key}。` })
    }
  }),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, ...input.clipRefs, input.focusRef], resolveOperationWriteTargets: input => [input.documentRef],
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['video_edit.clip', 'video_edit.sequence'], propertyIds: [], targetRefs: output.changedRefs, count: output.changedRefs.length, verified: output.verification.verified, evidence: [output.verification.condition] }], summarize: output => output.message,
})
const vector2 = z.tuple([z.number().finite(), z.number().finite()]).readonly()
const vector3 = spatialVec3Schema.readonly()
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict()
const matrix = z.array(z.number().finite()).length(16)
const cameraRecord = z.object({ kind: z.literal('camera'), frame, intent: videoEditSpatialCameraInputSchema.nullable(), position: vector3, target: vector3, up: vector3, sensorWidthMm: z.number().finite().positive(), fovYRadians: z.number().finite().positive(), fStop: z.number().finite().positive(), defocus: z.number().finite().nonnegative(), resolvedAim: vector3, resolvedFocus: vector3, targetActive: z.boolean(), focalLengthMm: z.number().finite().positive(), focusDistance: z.number().finite(), near: z.number().finite().positive(), far: z.number().finite().positive(), canonicalIdentity: z.boolean(), flatIdentity: z.boolean(), zeroBasis: z.literal('effective-values-and-bindings'), facts }).strict()
const cardRecord = z.object({ kind: z.literal('card'), frame, clipRef, originalQuad: z.array(vector3).length(4), visiblePolygon: z.array(vector3), screenPolygon: z.array(vector2), screenBounds: rect, logicalBounds: rect, anchorWorld: vector3, centerWorld: vector3, centerViewDepth: z.number().finite(), viewDepthRange: z.tuple([z.number().finite(), z.number().finite()]).readonly(), cocRadiusPx: z.number().finite().nonnegative(), cocRangePx: z.tuple([z.number().finite(), z.number().finite()]).readonly(), behindCamera: z.boolean(), clipped: z.boolean(), ambiguousDepth: z.boolean(), compoundGroup: z.string().optional(), drawOrder: z.number().int(), inFrameFraction: z.number().finite().min(0).max(1), visibleFraction: z.number().finite().min(0).max(1).nullable(), occludedBy: z.array(clipRef), coverage: z.array(z.array(z.array(vector2))), visibility: z.enum(['proven-visible', 'proven-occluded', 'estimated', 'unknown']), approximation: z.literal('layer-center'), sceneBoundsSource: z.enum(['render-observation', 'none']), focusOnCard: z.boolean().nullable(), clipFromUv: matrix }).strict()
export const verifyVideoEditSpaceCapability = defineApplicationCapability({
  id: 'verify_video_edit_space', version: 1, domain: 'video_edit', title: '验证空间构图', description: '只读分析指定序列帧的相机、裁剪、几何层序、遮挡候选和对焦，返回绑定内容身份的分页结构。不会执行作者源码；媒体 alpha、文字空白和未知场景不冒充像素可见。视觉核对请另用 observe_video_edit_frame，再读取图片。', aliases: ['空间验证', '空间读回', 'verify space'],
  readOnly: true, dataClasses: ['C1'], idempotent: true, destructive: false, timeoutMs: 120_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: [],
  inputSchema: z.object({ documentRef, sequenceRef, frames: z.array(frame).min(1), clipRefs: z.array(clipRef).optional(), cursor: z.string().optional() }).strict(),
  outputSchema: z.object({ documentRef, sequenceRef, documentVersion: z.string(), records: z.array(z.discriminatedUnion('kind', [cameraRecord, cardRecord])), nextCursor: z.string().nullable(), verificationKind: z.literal('structural'), message: z.string() }).strict(),
  control: capabilityControl('observe', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }), resolveOperationTargets: input => [input.documentRef, input.sequenceRef, ...(input.clipRefs ?? [])], resolveOperationWriteTargets: () => [], summarize: output => output.message,
})
export const VIDEO_EDIT_SPATIAL_CAPABILITIES = [arrangeVideoEditDepthCapability, transitionVideoEditSpaceCapability, verifyVideoEditSpaceCapability] as const
