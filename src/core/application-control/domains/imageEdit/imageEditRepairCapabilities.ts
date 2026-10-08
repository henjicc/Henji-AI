import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
const region = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selection'), ref: z.object({ kind: z.literal('image_edit.selection'), id: z.string().startsWith('v3:') }).strict() }).strict(),
  z.object({ kind: z.literal('rectangle'), x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict(),
])
const baseInput = z.object({ targetRef: layerRef, region, quality: z.enum(['fast', 'fine']).default('fast') }).strict()
export const imageEditRepairInputSchema = baseInput.extend({ sourceRegion: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict() }).strict()
const output = capabilityOutputSchema({ ref: layerRef, documentRef: z.object({ kind: z.literal('image_edit.document'), id: z.string() }).strict(), commandId: z.string(), verification: z.object({ verified: z.boolean() }).strict() })
const shared = {
  version: 1, domain: 'image_edit' as const, side: 'frontend' as const, readOnly: false,
  control: capabilityControl('update', ['image_edit.layer'], { revisionScopes: ['image_edit'], cancelable: true }),
  risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'image_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit' as const], acceptsRefs: ['image_edit.layer', 'image_edit.selection'], producesRefs: ['image_edit.layer', 'image_edit.document'],
  outputSchema: output,
  successEvidence: ['补丁已进入原文档瓦片与命令历史；原图资源不变，可撤销，并通过文档观察或既有导出回读合成图。'],
  failureRecovery: ['选区或图片改变时重新读回后处理；模型缺失复用本地模型按需下载；取消和算法失败不提交补丁。'],
  resolveOperationTargets: (input: z.infer<typeof baseInput>) => [input.targetRef],
  resolveOperationWriteTargets: (input: z.infer<typeof baseInput>) => [input.targetRef],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: (input: z.infer<typeof baseInput>) => `image_edit:${input.targetRef.id}`,
  resolveTargetIds: (input: z.infer<typeof baseInput>) => ({ layerId: input.targetRef.id }),
  summarize: () => '区域已修复，可观察结果或撤销。',
}
export const removeImageEditRegionCapability = defineApplicationCapability({ ...shared,
  id: 'remove_image_edit_region', title: '移除图片区域', aliases: ['修复', '移除物体', '去除杂物', 'remove object', 'inpaint'],
  description: '修复：移除选区引用或画面比例矩形内的物体，在当前像素层生成非破坏补丁，一步撤销。快速档本地推理、小瑕疵自动经典修补；精细档更慢。只采样当前层，不烘焙上方调整。比例坐标属于未裁剪画面；仅支持标准色域，人物主体语义尚未开放。首次使用复用本地模型下载。完成后用返回文档引用观察或导出合成图检查。',
  inputSchema: baseInput,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] }],
})
export const repairImageEditRegionCapability = defineApplicationCapability({ ...shared,
  id: 'repair_image_edit_region', title: '修补图片区域', aliases: ['修复', '指定来源修补', '纹理修补', 'repair region', 'patch tool'],
  description: '修复：把干净来源的纹理搬到选区或画面比例矩形，并向选区内部羽化边缘。sourceRegion 是干净来源区域中心的未裁剪画面比例坐标；保持目标选区形状和尺寸，来源与目标都属于指定像素层。非破坏补丁，一步撤销；不下载模型，不重烘焙调整。只支持标准色域。完成后用文档引用观察或导出合成图检查。',
  inputSchema: imageEditRepairInputSchema,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] }],
})
export const IMAGE_EDIT_REPAIR_CAPABILITIES = [removeImageEditRegionCapability, repairImageEditRegionCapability]
