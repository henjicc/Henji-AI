import { z } from 'zod'

import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'
import { applicationEffectReceiptSchema } from '../../application-control/transactions'

/*
 * imageEditSessionStore（6.1）的 undo/redo 是按 sessionId 分片的完整文档撤销/重做栈，
 * 与 canvasStore 的 undo/redo（undo_canvas_change/redo_canvas_change）同一先例：
 * 人在编辑器工具栏点"撤销/重做"按钮触发的就是这两个 store 动作，助手要达到同样效果
 * 直接调这两个能力即可。比 canvas 那套更简单——不需要 undoRef/historyDepth 校验，
 * imageEditSessionStore 的 undo()/redo() 本身就是纯 LIFO 栈，越界返回 null。
 */

const undoImageMarkChange = defineApplicationCapability({
  id: 'undo_image_mark_change',
  version: 1,
  title: '撤销标注编辑',
  description: '对指定标注编辑会话执行一次后进先出撤销（画笔、裁剪、旋转等文档级改动都会被计入这一个栈）。',
  domain: 'image_mark',
  aliases: ['撤销标注', 'undo image mark change'],
  readOnly: false,
  control: capabilityControl('update', ['image_mark.document'], { revisionScopes: ['image_mark'] }),
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'image_mark:write',
  idempotent: false,
  destructive: true,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['image_mark'],
  acceptsRefs: ['image_mark.document'],
  producesRefs: ['image_mark.document'],
  inputSchema: z.object({
    sessionId: z.string().min(1),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    sessionId: z.string(),
    status: z.literal('undone'),
  }),
  concurrencyKey: 'image_mark',
  resolveConcurrencyKey: (input) => `image_mark:${input.sessionId}`,
  resolveTargetIds: (input) => ({ sessionId: input.sessionId }),
  summarize: (output) => `已撤销标注编辑会话 ${output.sessionId} 的上一步操作。`,
})

const redoImageMarkChange = defineApplicationCapability({
  id: 'redo_image_mark_change',
  version: 1,
  title: '重做标注编辑',
  description: '重做指定标注编辑会话最近一次被撤销的文档改动。',
  domain: 'image_mark',
  aliases: ['重做标注', 'redo image mark change'],
  readOnly: false,
  control: capabilityControl('update', ['image_mark.document'], { revisionScopes: ['image_mark'] }),
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'image_mark:write',
  idempotent: false,
  destructive: true,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['image_mark'],
  acceptsRefs: ['image_mark.document'],
  producesRefs: ['image_mark.document'],
  inputSchema: z.object({
    sessionId: z.string().min(1),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    sessionId: z.string(),
    status: z.literal('redone'),
  }),
  concurrencyKey: 'image_mark',
  resolveConcurrencyKey: (input) => `image_mark:${input.sessionId}`,
  resolveTargetIds: (input) => ({ sessionId: input.sessionId }),
  summarize: (output) => `已重做标注编辑会话 ${output.sessionId} 的上一步操作。`,
})

export const IMAGE_MARK_APPLICATION_CAPABILITIES = [
  defineApplicationCapability({
    id: 'retry_image_edit_document_save', version: 1,
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
      id: z.string().startsWith('v3:').min(4) }).strict() }).strict(),
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
  undoImageMarkChange,
  redoImageMarkChange,
]
