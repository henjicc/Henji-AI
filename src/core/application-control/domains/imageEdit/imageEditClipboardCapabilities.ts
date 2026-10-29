import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const documentRef = z.object({ kind: z.literal('image_edit.document'), id: z.string().startsWith('v3:') }).strict()
const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
export const imageEditClipboardCapability = defineApplicationCapability({
  id: 'use_image_edit_clipboard', version: 1, title: '图片复制粘贴',
  description: '复制图片文档指定图层或合成结果到系统剪贴板，当前选区会限制复制范围；或把系统剪贴板图片粘贴为新图层。编辑器内部复制保留可编辑图层。复制需要 layerRefs；copy_merged 不需要。粘贴可一次撤销。',
  domain: 'image_edit', side: 'frontend', aliases: ['复制图片', '粘贴图片', '复制合成结果'], readOnly: false,
  control: capabilityControl('execute', ['image_edit.document'], { revisionScopes: ['image_edit'], cancelable: true,
    alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.layer'] }] }), dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false,
  timeoutMs: 120_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'],
  acceptsRefs: ['image_edit.document', 'image_edit.layer'], producesRefs: ['image_edit.document', 'image_edit.layer'],
  inputSchema: z.object({ documentRef, action: z.enum(['copy', 'copy_merged', 'paste']), layerRefs: z.array(layerRef).optional() }).strict()
    .refine(input => input.action !== 'copy' || Boolean(input.layerRefs?.length), '复制图层需要 layerRefs'),
  outputSchema: capabilityOutputSchema({ ref: z.union([documentRef, layerRef]), verified: z.boolean() }),
  successEvidence: ['复制后系统剪贴板读到图片；粘贴后正式图层可读回。'], failureRecovery: ['剪贴板中无图片时先复制图片；作品变化时重新读取后复制。'],
  resolveOperationTargets: input => [input.documentRef, ...(input.layerRefs ?? [])],
  resolveOperationWriteTargets: input => input.action === 'paste' ? [input.documentRef] : [],
  resolveObservedEffects: (input, output) => [{ effect: input.action === 'paste' ? 'create' : 'execute',
    entityTypes: [output.ref.kind], propertyIds: [], targetRefs: [output.ref], count: 1, verified: output.verified, evidence: [] }],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.documentRef.id}`,
  resolveTargetIds: input => ({ documentId: input.documentRef.id }), summarize: () => '图片剪贴板操作已完成。',
})
