import { z } from 'zod'

import { canvasBatchOperationSchema } from '../../../../../../src/core/assistant/hostContracts'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import { eraseToolDefinition, expectedRevision, requireFrontendSuccess, type FrontendToolInvoker } from './frontend-utils'

const revisionOutput = {
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number()),
}

export function createFrontendCanvasBatchTools(invoke: FrontendToolInvoker): AgentToolDefinition[] {
  const getProject = defineAgentTool({
    name: 'get_canvas_project', version: 1, title: '读取画布项目详情',
    description: '读取明确画布项目的节点/连接摘要；大媒体和完整画布数据不会进入上下文。', category: 'canvas', side: 'frontend',
    risk: 'R0', permission: 'canvas:read', readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
    outputSchema: z.object({ project: z.record(z.string(), z.unknown()), nodes: z.array(z.record(z.string(), z.unknown())), edges: z.array(z.record(z.string(), z.unknown())), truncated: z.boolean(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'query', query: { name: 'get_canvas_project', input } }, context)),
    concurrencyKey: (input) => `canvas_project:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId }), dataClasses: () => ['C1'],
    summarize: (output) => `画布项目包含 ${Array.isArray(output.nodes) ? output.nodes.length : 0} 个节点。`,
  })

  const getNode = defineAgentTool({
    name: 'get_canvas_node', version: 1, title: '读取画布节点详情',
    description: '读取明确节点的配置摘要与相邻连接，媒体原文只返回引用存在性。', category: 'canvas', side: 'frontend',
    risk: 'R0', permission: 'canvas:read', readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1) }).strict(),
    outputSchema: z.object({ node: z.record(z.string(), z.unknown()), connectedEdges: z.array(z.record(z.string(), z.unknown())), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeId: { type: 'string' } }, required: ['projectId', 'nodeId'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'query', query: { name: 'get_canvas_node', input } }, context)),
    concurrencyKey: (input) => `canvas_node:${input.nodeId}`, targetIds: (input) => ({ projectId: input.projectId, nodeId: input.nodeId }), dataClasses: () => ['C1'],
    summarize: (output) => `已读取画布节点 ${String((output.node as Record<string, unknown>).id ?? '')}。`,
  })

  const planBatch = defineAgentTool({
    name: 'plan_canvas_batch', version: 1, title: '规划画布批量操作',
    description: '先校验多个画布操作并生成稳定 planRef；不会修改画布，后续必须先预览再提交。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:plan', readOnly: true, destructive: false, openWorld: false, idempotent: false,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), operations: z.array(canvasBatchOperationSchema).min(1).max(20) }).strict(),
    outputSchema: z.object({ planRef: z.string(), projectId: z.string(), operationCount: z.number(), operations: z.array(z.record(z.string(), z.unknown())), reversible: z.boolean(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, operations: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 20 } }, required: ['projectId', 'operations'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'query', query: { name: 'plan_canvas_batch', input } }, context)),
    concurrencyKey: (input) => `canvas_plan:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId }), dataClasses: () => ['C1'],
    summarize: (output) => `已生成包含 ${String(output.operationCount)} 个步骤的画布批量计划。`,
  })

  const previewBatch = defineAgentTool({
    name: 'preview_canvas_batch', version: 1, title: '预览画布批量操作',
    description: '展示已生成画布批量计划的步骤、目标和可撤销性，不修改画布。', category: 'canvas', side: 'frontend',
    risk: 'R0', permission: 'canvas:preview', readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
    outputSchema: z.object({ planRef: z.string(), projectId: z.string(), operations: z.array(z.record(z.string(), z.unknown())), summary: z.string(), reversible: z.boolean(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { planRef: { type: 'string' } }, required: ['planRef'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'query', query: { name: 'preview_canvas_batch', input } }, context)),
    concurrencyKey: (input) => `canvas_plan:${input.planRef}`, targetIds: (input) => ({ planRef: input.planRef }), dataClasses: () => ['C0'],
    summarize: (output) => String(output.summary),
  })

  const commitBatch = defineAgentTool({
    name: 'commit_canvas_batch', version: 1, title: '提交画布批量操作',
    description: '提交已预览的画布批量计划；所有步骤按代码定义顺序执行，成功后只生成一个 undoRef。', category: 'canvas', side: 'frontend',
    risk: 'R2', permission: 'canvas:batch_write', readOnly: false, destructive: true, openWorld: false, idempotent: false,
    timeoutMs: 30_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
    outputSchema: z.object({ planRef: z.string(), projectId: z.string(), appliedOperations: z.array(z.record(z.string(), z.unknown())), operationCount: z.number(), undoRef: z.string(), status: z.literal('committed'), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { planRef: { type: 'string' } }, required: ['planRef'], additionalProperties: false },
    preview: (input) => ({ title: '提交画布批量操作', summary: `提交画布批量计划 ${input.planRef}，成功后提供单次撤销。`, targetIds: { planRef: input.planRef }, reversible: true, dataClasses: ['C1'] }),
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'commit_canvas_batch', input, expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']) } }, context)),
    concurrencyKey: (input) => `canvas_batch:${input.planRef}`, targetIds: (input) => ({ planRef: input.planRef }), dataClasses: () => ['C1'],
    summarize: (output) => `画布批量计划已提交，${String(output.operationCount)} 个步骤完成。`,
    undo: (output) => ({ kind: 'canvas_history', token: String(output.undoRef) }),
  })

  return [eraseToolDefinition(getProject), eraseToolDefinition(getNode), eraseToolDefinition(planBatch), eraseToolDefinition(previewBatch), eraseToolDefinition(commitBatch)]
}
