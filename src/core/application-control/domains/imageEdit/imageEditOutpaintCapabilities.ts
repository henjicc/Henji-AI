import { z } from 'zod';
import { imageEditOutpaintMarginsSchemaV3 } from '../../../imageEdit/v3/aiWorkflows/outpaint';
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability';

const documentRef = z.object({ kind: z.literal('image_edit.document'), id: z.string().startsWith('v3:') }).strict();
const taskRef = z.object({ kind: z.literal('generation.task'), id: z.string().min(1) }).strict();
export const imageEditOutpaintInputSchema = z.object({ documentRef, margins: imageEditOutpaintMarginsSchemaV3.describe('相对于原画幅的扩展比例：right=0.25 表示右侧增加原宽度的 25%，bottom=0.5 表示下方增加原高度的 50%。left/top 为左/上扩展比例，可省略表示不扩展；至少一边大于零。'),
  prompt: z.string().trim().min(1).describe('新增画面的内容描述；模型自动收到当前合成图与新增边缘，不必手动上传。'),
  modelId: z.string().min(1).optional(), params: z.record(z.string(), z.unknown()).optional() }).strict();
const common = { version: 1, domain: 'image_edit' as const, side: 'frontend' as const, dataClasses: ['C1' as const], idempotent: true, destructive: false, supportsPreview: false,
  requiredScopes: ['image_edit' as const], acceptsRefs: ['image_edit.document', 'generation.task'], producesRefs: ['generation.task', 'image_edit.layer'],
  concurrencyKey: 'image_edit_outpaint',
};
export const prepareImageEditOutpaintCapability = defineApplicationCapability({ ...common,
  id: 'prepare_image_edit_outpaint', title: '检查图片扩图', aliases: ['扩图估价'], description: '校验当前图片扩图画幅、已配置图片模型、参数与预估费用，不导出、不上传、不生成、不修改图片。仅支持标准色域与未裁剪、未旋转画面；HDR 与宽色域明确拒绝。',
  readOnly: true, risk: 'R0', permission: 'image_edit:read', timeoutMs: 60000, supportsUndo: false,
  inputSchema: imageEditOutpaintInputSchema, outputSchema: z.object({ documentRef, preparation: z.object({ prepared: z.literal(true), modelId: z.string(), providerId: z.string(), mediaType: z.literal('image'), options: z.record(z.string(), z.unknown()) }).passthrough(), message: z.string() }).strict(),
  resolveOperationTargets: input => [input.documentRef], resolveConcurrencyKey: input => `image_edit_outpaint:${input.documentRef.id}`,
  resolveOperationWriteTargets: () => [], control: capabilityControl('observe', ['image_edit.document', 'generation.preparation']), summarize: result => result.message,
});
export const generateImageEditOutpaintCapability = defineApplicationCapability({ ...common,
  id: 'generate_image_edit_outpaint', title: '在当前图片扩图', aliases: ['AI 扩图', '自然补边', 'outpaint'],
  description: '按原画幅比例向任意方向扩展当前图片。先取当前合成画面与透明新增边缘作为参考，复用正式图片生成队列；按所选模型计费。提交立即返回 taskRef，当前图片显示进度占位，用户可继续编辑。完成后扩边和带蒙版的智能对象新层作为一步可撤销编辑进入原文档，原图像素不改。先 prepare_image_edit_outpaint 确认参数和费用，再提交；用 get_image_edit_outpaint 读回落位，不把生成完成当成文档已保存。取消走 cancel_generation_task；生成成功但落位或保存失败用 recover_image_edit_outpaint 恢复原结果，禁止重复付费。',
  readOnly: false, risk: 'R2', permission: 'generation:create', timeoutMs: 180000, supportsUndo: true, completionKind: 'submitted', requiredScopes: ['image_edit', 'generation'],
  executionPrerequisites: ['prepare_image_edit_outpaint'], paidGenerationPreparation: 'prepare_image_edit_outpaint',
  inputSchema: imageEditOutpaintInputSchema, outputSchema: z.object({ documentRef, taskRef, status: z.literal('submitted'), message: z.string() }).strict(),
  resolveOperationTargets: input => [input.documentRef], resolveConcurrencyKey: input => `image_edit_outpaint:${input.documentRef.id}`,
  resolveOperationWriteTargets: input => [input.documentRef], control: capabilityControl('execute', ['generation.task'], { revisionScopes: ['image_edit', 'generation'], resultState: 'submitted', verificationRequired: false, alsoImpacts: [{ effect: 'create', entityTypes: ['generation.task'] }] }),
  successEvidence: ['返回正式生成任务；落位与保存须进一步读回 status=placed。'], failureRecovery: ['恢复原任务只续落位或保存，不重复生成。'], summarize: result => result.message,
  resolveObservedEffects: (_input, output) => [{ effect: 'create', entityTypes: ['generation.task'], propertyIds: [], targetRefs: [output.taskRef], count: 1, verified: false, evidence: [] }],
});
const recoveryInput = z.object({ documentRef, taskRef }).strict();
const statusOutput = z.object({ documentRef, taskRef, status: z.enum(['preparing', 'generating', 'placing', 'placed', 'failed', 'cancelled']), progress: z.number(), layerRef: z.object({ kind: z.literal('image_edit.layer'), id: z.string() }).strict().optional(), error: z.string().optional(), message: z.string() }).strict();
export const getImageEditOutpaintCapability = defineApplicationCapability({ ...common,
  id: 'get_image_edit_outpaint', title: '读取图片扩图结果', aliases: ['扩图进度'], description: '按原任务引用读回扩图进度、失败原因与新层引用。placed 表示结果已落入原图片且保存确认。',
  readOnly: true, risk: 'R0', permission: 'image_edit:read', timeoutMs: 30000, supportsUndo: false, inputSchema: recoveryInput, outputSchema: statusOutput,
  resolveOperationTargets: input => [input.documentRef], resolveConcurrencyKey: input => `image_edit_outpaint:${input.documentRef.id}`,
  resolveOperationWriteTargets: () => [], control: capabilityControl('observe', ['image_edit.document', 'generation.task']), summarize: result => result.message,
});
export const recoverImageEditOutpaintCapability = defineApplicationCapability({ ...common,
  id: 'recover_image_edit_outpaint', title: '恢复原图片扩图任务', aliases: ['恢复扩图', '扩图保存重试'], description: '按原任务引用恢复等待、落位或保存，不提交新的生成、不产生第二次生成费用。读取生成记录中的原画幅与目标图片；已落位的智能对象来源作为持久回执，只续保存。原画幅已变化时拒绝错误落位。',
  readOnly: false, risk: 'R1', permission: 'image_edit:write', timeoutMs: 60000, supportsUndo: true, completionKind: 'submitted', inputSchema: recoveryInput, outputSchema: statusOutput,
  resolveOperationTargets: input => [input.documentRef], resolveConcurrencyKey: input => `image_edit_outpaint:${input.documentRef.id}`,
  resolveOperationWriteTargets: input => [input.documentRef], control: capabilityControl('execute', ['image_edit.document'], { revisionScopes: ['image_edit'], verificationRequired: false, resultState: 'submitted' }), summarize: result => result.message,
});
export const IMAGE_EDIT_OUTPAINT_CAPABILITIES = [prepareImageEditOutpaintCapability, generateImageEditOutpaintCapability, getImageEditOutpaintCapability, recoverImageEditOutpaintCapability];
