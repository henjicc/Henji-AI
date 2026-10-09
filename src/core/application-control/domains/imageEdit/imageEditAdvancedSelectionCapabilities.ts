import { z } from 'zod'
import { imageEditAdvancedSelectionIntentSchemaV3 } from '../../../imageEdit/v3/selection/advanced'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
const selectionRef = z.object({ kind: z.literal('image_edit.selection'), id: z.string().startsWith('v3:') }).strict()
export const computeImageEditSelectionCapability = defineApplicationCapability({
  id: 'compute_image_edit_selection', version: 1, title: '计算图片选区', domain: 'image_edit', side: 'frontend',
  description: '按魔棒颜色容差、多个颜色取样或焦点清晰度计算独立选区，也可扩展、收缩、平滑、羽化或取边界。取样点是未裁剪画面的比例坐标，radiusRatio 是画面短边比例。结果保留软边覆盖率，可通用读取 image_edit.selection.region、人工校正、应用蒙版或撤销。焦点依据纹理而非主体识别。修改已有选区忽略 combine，其他计算按 combine 组合。',
  aliases: ['魔棒', '色彩范围', '焦点区域', '扩展选区', '羽化选区'], readOnly: false,
  control: capabilityControl('update', ['image_edit.selection'], { propertyIds: ['image_edit.selection.region'], revisionScopes: ['image_edit'], cancelable: true }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer'], producesRefs: ['image_edit.selection'],
  inputSchema: z.object({ targetRef: layerRef, operation: imageEditAdvancedSelectionIntentSchemaV3, combine: z.enum(['replace', 'add', 'subtract', 'intersect']).default('replace') }).strict(),
  outputSchema: capabilityOutputSchema({ ref: selectionRef, verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['正式选区可读回并进入撤销栈。'], failureRecovery: ['目标或选区变化后重新读取；取消不改变作品。'],
  resolveOperationTargets: input => [input.targetRef],
  resolveOperationWriteTargets: input => [{ kind: 'image_edit.selection', id: input.targetRef.id.slice(0, input.targetRef.id.lastIndexOf(':')) }],
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['image_edit.selection'], propertyIds: ['image_edit.selection.region'], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] }],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.targetRef.id}`,
  resolveTargetIds: input => ({ layerId: input.targetRef.id }), summarize: () => '选区已计算，可回读、校正或撤销。',
})
