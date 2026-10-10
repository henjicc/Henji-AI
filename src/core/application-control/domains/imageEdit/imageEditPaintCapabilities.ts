import { z } from 'zod';
import { imageEditPaintIntentSchemaV3 } from '../../../imageEdit/v3/brush/intent';
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability';

const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict();
export const paintImageEditTargetCapability = defineApplicationCapability({
  id: 'paint_image_edit_target', version: 1, title: '绘画、填充或修饰图片区域', domain: 'image_edit', side: 'frontend',
  description: '在显式图层的像素或已有蒙版上绘制、擦除、纯色填充或线性/径向渐变。points/start/end 是目标图层内容空间的比例坐标，允许画外；sizeRatio 按该目标短边比例。opacity 控制整笔透明度，flow 控制笔内叠加，pressureSize/pressureFlow 分别启用压感。color 是 sRGB 色值，maskValue 是 0～1 覆盖。渐变 stops 按 position 从小到大排序，像素需 color、蒙版用 maskValue。当前文档有选区时自动限制在选区内，没有选区则整个目标可编辑。一次操作可撤销；普通图层、蒙版和选区属性继续用通用实体读写。operation.kind=clone 为仿制图章、heal 为修复画笔，仅支持 pixels；source 是同图层干净供体的比例坐标，对应 points 第一落点，此后保持供体偏移。整笔从笔前不可变像素取样，heal 保留目标透明度并融合目标明暗；来源在边界外时不伸展边缘。',
  aliases: ['画笔', '橡皮', '渐变', '填充', '绘画蒙版', '仿制图章', '修复画笔', 'clone stamp', 'healing brush'], readOnly: false,
  control: capabilityControl('update', ['image_edit.layer', 'image_edit.mask'], { revisionScopes: ['image_edit'], cancelable: true }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer'], producesRefs: ['image_edit.layer', 'image_edit.mask'],
  inputSchema: z.object({ targetRef: layerRef, destination: z.enum(['pixels', 'mask']).default('pixels'), operation: imageEditPaintIntentSchemaV3 }).strict(),
  outputSchema: capabilityOutputSchema({ ref: z.union([layerRef, z.object({ kind: z.literal('image_edit.mask'), id: z.string().startsWith('v3:') }).strict()]), changed: z.boolean(), commandId: z.string().nullable(), verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['目标图层或蒙版的正式像素资源读回与撤销历史一致。'], failureRecovery: ['目标锁定或蒙版缺失时先读取图层与蒙版实体；取消不写作品，目标变化后重新操作。'],
  resolveOperationTargets: input => [input.targetRef], resolveOperationWriteTargets: input => [input.targetRef],
  resolveObservedEffects: (input, output) => output.changed ? [{ effect: 'update', entityTypes: [input.destination === 'mask' ? 'image_edit.mask' : 'image_edit.layer'],
    targetRefs: [output.ref], propertyIds: [], count: 1, verified: output.verification.verified, evidence: [] }] : [],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.targetRef.id}`,
  resolveTargetIds: input => ({ layerId: input.targetRef.id }), summarize: () => '绘画结果已写入，可读取或撤销。',
});
