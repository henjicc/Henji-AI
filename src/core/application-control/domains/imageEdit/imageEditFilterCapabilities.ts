import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
const filterRef = z.object({ kind: z.literal('image_edit.layer_filter'), id: z.string().startsWith('v3:') }).strict()
export const convertImageEditFilterScopeCapability = defineApplicationCapability({
  id: 'convert_image_edit_filter_scope', version: 1, title: '转换滤镜作用范围', domain: 'image_edit', side: 'frontend',
  description: '把普通图层滤镜转为位于原图层上方的滤镜图层，作用扩展到同组下方合成；或把滤镜图层挂回同组紧邻下方的像素图层/图层组，作用缩至该目标。仅可表达相同设置时转换，不烘焙变换或丢弃嵌套滤镜。一次转换一次撤销，保留参数、蒙版与混合设置。输入是普通滤镜引用或滤镜图层引用，返回转换后的真实引用和作用范围名称供回读检查。',
  aliases: ['滤镜转图层', '挂回图层滤镜'], readOnly: false,
  control: capabilityControl('update', ['image_edit.layer'], { revisionScopes: ['image_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.layer'] }, { effect: 'delete', entityTypes: ['image_edit.layer'] }] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: true, timeoutMs: 30_000,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer', 'image_edit.layer_filter'], producesRefs: ['image_edit.layer', 'image_edit.layer_filter'],
  inputSchema: z.object({ targetRef: z.union([layerRef, filterRef]) }).strict(),
  outputSchema: capabilityOutputSchema({ ref: z.union([layerRef, filterRef]), ownerRef: layerRef, commandId: z.string(), beforeTargets: z.array(z.string()), afterTargets: z.array(z.string()), verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['转换结果进入单条正式历史且目标存在。'], failureRecovery: ['读回同组下方图层；恢复无法表达的变换或蒙版设置后重新转换。'],
  resolveOperationTargets: input => [input.targetRef], resolveOperationWriteTargets: input => [input.targetRef],
  resolveObservedEffects: (input, output) => [{ effect: 'update', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [output.ownerRef], count: 1, verified: output.verification.verified, evidence: [] },
    { effect: input.targetRef.kind === 'image_edit.layer_filter' ? 'create' : 'delete', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [input.targetRef.kind === 'image_edit.layer_filter' ? output.ref : input.targetRef], count: 1, verified: output.verification.verified, evidence: [] }],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.targetRef.id}`, resolveTargetIds: input => ({ layerId: input.targetRef.id }), summarize: () => '滤镜作用范围已转换，可检查结果或一次撤销。',
})
