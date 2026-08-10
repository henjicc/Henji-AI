import { z } from 'zod'

import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'

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
  undoImageMarkChange,
  redoImageMarkChange,
]
