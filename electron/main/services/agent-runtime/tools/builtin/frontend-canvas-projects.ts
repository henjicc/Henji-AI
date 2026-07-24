import { z } from 'zod'

import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import { eraseToolDefinition, expectedRevision, requireFrontendSuccess, type FrontendToolInvoker } from './frontend-utils'

const revisionOutput = {
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number()),
}

export function createFrontendCanvasProjectTools(invoke: FrontendToolInvoker): AgentToolDefinition[] {
  const createProject = defineAgentTool({
    name: 'create_canvas_project', version: 1, title: '新建画布项目',
    description: '创建空画布项目并进入画布工作区。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:project_write', readOnly: false, destructive: false, openWorld: false,
    idempotent: false, timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    outputSchema: z.object({ projectId: z.string().min(1), name: z.string().min(1), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 120 } }, required: ['name'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: {
      name: 'create_canvas_project', input,
      expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
    } }, context)),
    concurrencyKey: () => 'canvas_project', targetIds: () => ({}), dataClasses: () => ['C1'],
    summarize: (output) => `已创建画布项目 ${String(output.projectId)}。`,
  })

  const closeProject = defineAgentTool({
    name: 'close_canvas_project', version: 1, title: '关闭画布项目',
    description: '保存并关闭明确的当前画布项目。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:project_write', readOnly: false, destructive: false, openWorld: false,
    idempotent: true, timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string().min(1), status: z.literal('closed'), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: {
      name: 'close_canvas_project', input,
      expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
    } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId }), dataClasses: () => ['C1'],
    summarize: (output) => `已关闭画布项目 ${String(output.projectId)}。`,
  })

  const renameProject = defineAgentTool({
    name: 'rename_canvas_project', version: 1, title: '重命名画布项目',
    description: '重命名明确的画布项目。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:project_write', readOnly: false, destructive: false, openWorld: false,
    idempotent: true, timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120) }).strict(),
    outputSchema: z.object({ projectId: z.string().min(1), name: z.string().min(1), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, name: { type: 'string', maxLength: 120 } }, required: ['projectId', 'name'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: {
      name: 'rename_canvas_project', input,
      expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
    } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId }), dataClasses: () => ['C1'],
    summarize: (output) => `已将画布项目重命名为 ${String(output.name)}。`,
  })

  const deleteProject = defineAgentTool({
    name: 'delete_canvas_project', version: 1, title: '删除画布项目',
    description: '删除明确的画布项目及其持久化画布数据，无法撤销。', category: 'canvas', side: 'frontend',
    risk: 'R3', permission: 'canvas:project_delete', readOnly: false, destructive: true, openWorld: false,
    idempotent: true, timeoutMs: 10_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string().min(1), status: z.literal('deleted'), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
    preview: (input) => ({ title: '删除画布项目', summary: `永久删除项目 ${input.projectId} 及其画布数据。`, targetIds: { projectId: input.projectId }, reversible: false, dataClasses: ['C1'] }),
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: {
      name: 'delete_canvas_project', input,
      expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
    } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId }), dataClasses: () => ['C1'],
    summarize: (output) => `已删除画布项目 ${String(output.projectId)}。`,
  })

  return [
    eraseToolDefinition(createProject),
    eraseToolDefinition(closeProject),
    eraseToolDefinition(renameProject),
    eraseToolDefinition(deleteProject),
  ]
}
