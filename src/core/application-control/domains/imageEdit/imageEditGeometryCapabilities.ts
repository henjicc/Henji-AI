import { z } from 'zod';
import { documentSizeSchemaV3 } from '../../../imageEdit/v3/documentGeometry';
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability';
const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict();
const documentRef = z.object({ kind: z.literal('image_edit.document'), id: z.string().startsWith('v3:') }).strict();
export const resampleImageEditCapability = defineApplicationCapability({
  id: 'resample_image_edit_image', version: 1, title: '重采样或内容识别缩放图片', domain: 'image_edit', side: 'frontend',
  description: '按正整数 width/height 重采样整幅图像。method=resample 使用共享双线性采样；content-aware 用低细节缝缩放，protectSelection=true 保护当前选区（先用通用实体设置选区）。像素与命名选区使用同一位移，原稿图层、路径、独立蒙版和滤镜保留在可编辑内容中，应用后一次撤销。建筑和重复纹理需读回检查失真，必要时撤销后用 resample。只改画布边界请写 image_edit.document.canvas_size。',
  aliases: ['图像尺寸', '内容识别缩放', 'seam carving'], readOnly: false,
  control: capabilityControl('update', ['image_edit.document'], { revisionScopes: ['image_edit'], cancelable: true, alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.layer'] }, { effect: 'delete', entityTypes: ['image_edit.layer'] }] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false, timeoutMs: 300_000,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.document'], producesRefs: ['image_edit.document'],
  inputSchema: documentSizeSchemaV3.extend({ documentRef, method: z.enum(['resample', 'content-aware']).default('resample'), protectSelection: z.boolean().default(false) }),
  outputSchema: capabilityOutputSchema({ ref: documentRef, commandId: z.string(), createdLayers: z.array(layerRef), removedLayers: z.array(layerRef), width: z.number().int().positive(), height: z.number().int().positive(), verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['正式文档宽高、结果图层与同一历史命令可读回。'], failureRecovery: ['取消或失效预览不改作品；读回当前文档、选区后重试；失真时撤销并改用普通重采样。'],
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['image_edit.document'], propertyIds: [], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] },
    { effect: 'create', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: output.createdLayers, count: output.createdLayers.length, verified: output.verification.verified, evidence: [] },
    { effect: 'delete', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: output.removedLayers, count: output.removedLayers.length, verified: output.verification.verified, evidence: [] }],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.documentRef.id}`, resolveTargetIds: input => ({ documentId: input.documentRef.id }), summarize: () => '图像尺寸已调整，可读回检查或一次撤销。',
});
