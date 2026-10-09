import { z } from 'zod'

import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { applicationEffectReceiptSchema } from '../../transactions'

export const IMAGE_MARK_APPLICATION_CAPABILITIES = [
  defineApplicationCapability({
    id: 'retry_image_edit_document_save',
  external: { kind: 'recovery', reason: '仅保存恢复入口，必须绑定原失败操作与原图片文档宿主，只能由 retry_application_operation_save 按账本触发。' },
  version: 1,
    title: '重试保存图片编辑文档',
    description: '确认当前图片文档的最新内容已经保存；附着画布节点时同步其正式预览。只重试保存，不重复编辑、添加或撤销命令。',
    domain: 'image_edit', aliases: ['图片编辑保存失败', '重试保存图片', 'retry image document save'],
    readOnly: false,
    control: capabilityControl('execute', ['image_edit.document'], { revisionScopes: ['image_edit', 'canvas'],
      alsoImpacts: [{ effect: 'update', entityTypes: ['canvas.node'] }, { effect: 'execute', entityTypes: ['canvas.node'] }] }),
    risk: 'R1', dataClasses: ['C1'], permission: 'application:write',
    idempotent: true, destructive: false, timeoutMs: 120_000,
    supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit', 'canvas'],
    acceptsRefs: ['image_edit.document'], producesRefs: ['image_edit.document'],
    successEvidence: ['当前文档和必要的节点投影已由同一宿主完成持久化确认，编辑命令未重放。'],
    failureRecovery: ['保留当前内容，只重试保存；原编辑器已关闭时先从原文档节点重新打开并核对。'],
    inputSchema: z.object({ documentRef: z.object({ kind: z.literal('image_edit.document'),
      id: z.string().startsWith('v3:').min(4) }).strict(), expectedOwnerId: z.string().uuid().optional() }).strict(),
    outputSchema: capabilityOutputSchema({ ref: z.object({ kind: z.literal('image_edit.document'),
      id: z.string().min(1) }).strict(), status: z.literal('persisted'),
      effects: z.array(applicationEffectReceiptSchema), resultingRevisions: z.record(z.string(), z.number().int().nonnegative()) }),
    resolveObservedEffects: (_input, output) => [
      { effect: 'execute', entityTypes: ['image_edit.document'], propertyIds: [], targetRefs: [output.ref], count: 1, verified: true, evidence: [] },
      ...output.effects.map((effect) => ({ effect: effect.effect, entityTypes: [effect.entityType], propertyIds: effect.propertyIds,
        targetRefs: effect.refs, count: effect.refs.length, verified: true, evidence: [] })),
    ],
    concurrencyKey: 'image_edit', resolveConcurrencyKey: (input) => `image_edit:${input.documentRef.id}`,
    resolveTargetIds: (input) => ({ documentId: input.documentRef.id }),
    summarize: () => '图片编辑内容已保存，未重复执行原操作。',
  }),
]
