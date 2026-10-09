import { z } from 'zod'
import { imageEditSubjectRegionSchemaV3 } from '../../../imageEdit/v3/subjectSelection'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
const selectionRef = z.object({ kind: z.literal('image_edit.selection'), id: z.string().startsWith('v3:') }).strict()
export const imageEditSubjectSelectionInputSchema = z.object({ targetRef: layerRef, region: imageEditSubjectRegionSchemaV3.default({ kind: 'subject' }),
  candidateId: z.string().min(1).optional(), combine: z.enum(['replace', 'add', 'subtract', 'intersect']).default('replace') }).strict()
const bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict()
export const selectImageEditRegionCapability = defineApplicationCapability({
  id: 'select_image_edit_region', version: 1, domain: 'image_edit', side: 'frontend', title: '选择图片主体', aliases: ['选择区域', '选择主体', '人像选区', '点选主体', '框选主体', 'select region', 'select subject'],
  description: '选择当前像素层的主体或人像，或按未裁剪画面比例坐标点选/框选，可用正负点细化；结果写入可读回、可撤销的独立选区。多主体时返回候选位置与 candidateId，选定后再调用同一能力；候选过期需重新识别。不猜目标、不修改图片像素。首次使用按需下载本地模型，标准色域图片适用。完成后读取 image_edit.selection.region 或观察文档检查边缘，移除可直接消费该选区。',
  readOnly: false, control: capabilityControl('update', ['image_edit.selection'], { propertyIds: ['image_edit.selection.region'], revisionScopes: ['image_edit'], cancelable: true,
    alsoImpacts: [{ effect: 'observe', entityTypes: ['image_edit.layer'] }] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false, timeoutMs: 600_000,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer'], producesRefs: ['image_edit.selection'],
  inputSchema: imageEditSubjectSelectionInputSchema,
  outputSchema: capabilityOutputSchema({ ref: selectionRef, status: z.enum(['selected', 'candidates']),
    candidates: z.array(z.object({ id: z.string(), bounds, area: z.number().min(0).max(1), score: z.number().finite() }).strict()), verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['单一或选定主体进入选区实体并可读回；歧义只返回绑定原图层的候选，不改选区。'],
  failureRecovery: ['未识别到主体时改用点或框；图片/选区改变后重新识别；首次模型下载可从本地模型入口查看或取消。'],
  resolveOperationTargets: input => [input.targetRef],
  resolveOperationWriteTargets: input => [{ kind: 'image_edit.selection', id: input.targetRef.id.slice(0, input.targetRef.id.lastIndexOf(':')) }],
  resolveTargetIds: input => ({ layerId: input.targetRef.id }), concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.targetRef.id}`,
  resolveObservedEffects: (input, output) => output.status === 'selected'
    ? [{ effect: 'update', entityTypes: ['image_edit.selection'], propertyIds: ['image_edit.selection.region'], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] }]
    : [{ effect: 'observe', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [input.targetRef], count: 1, verified: output.verification.verified, evidence: [] }],
  summarize: output => output.status === 'selected' ? '主体已选中，可检查边缘、应用或撤销。' : '发现多个主体，请按位置选择候选。',
})
