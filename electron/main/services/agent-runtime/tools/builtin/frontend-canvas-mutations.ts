import { z } from 'zod'

import type { HostScopeRevisions } from '../../../../../../src/core/assistant/hostContracts'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import { eraseToolDefinition, expectedRevision, requireFrontendSuccess, type FrontendToolInvoker } from './frontend-utils'

const revisionOutput = {
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number()),
}

const placementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('viewport_center') }).strict(),
  z.object({ mode: z.literal('right_of_node'), anchorNodeId: z.string().min(1) }).strict(),
])

function canvasExpectedRevision(context: { hostContext: { scopeRevisions: HostScopeRevisions } | null }): Partial<HostScopeRevisions> | undefined {
  return expectedRevision(context.hostContext?.scopeRevisions, ['canvas'])
}

export function createFrontendCanvasMutationTools(invoke: FrontendToolInvoker): AgentToolDefinition[] {
  const duplicateNode = defineAgentTool({
    name: 'duplicate_canvas_node', version: 1, title: '复制画布节点',
    description: '复制明确节点的安全配置，并按确定性布局放置；不会复制运行时状态或本地文件原文。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:write', readOnly: false, destructive: false, openWorld: false, idempotent: false,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1), placement: placementSchema }).strict(),
    outputSchema: z.object({ projectId: z.string(), nodeId: z.string(), duplicatedFromNodeId: z.string(), undoRef: z.string(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeId: { type: 'string' }, placement: { type: 'object', additionalProperties: true } }, required: ['projectId', 'nodeId', 'placement'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'duplicate_canvas_node', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId, nodeId: input.nodeId }), dataClasses: () => ['C1'],
    summarize: (output) => `已复制画布节点 ${String(output.duplicatedFromNodeId)} 为 ${String(output.nodeId)}。`,
  })

  const updateNode = defineAgentTool({
    name: 'update_canvas_node', version: 1, title: '更新画布节点',
    description: '按节点 schema 更新明确节点的可编辑数据；模型、参数和媒体字段必须先从对应目录/schema 获得。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:write', readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1), data: z.record(z.string(), z.unknown()) }).strict(),
    outputSchema: z.object({ projectId: z.string(), nodeId: z.string(), updatedKeys: z.array(z.string()), undoRef: z.string(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeId: { type: 'string' }, data: { type: 'object', additionalProperties: true } }, required: ['projectId', 'nodeId', 'data'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'update_canvas_node', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}:${input.nodeId}`, targetIds: (input) => ({ projectId: input.projectId, nodeId: input.nodeId }), dataClasses: () => ['C1'],
    summarize: (output) => `已更新画布节点 ${String(output.nodeId)}。`,
  })

  const deleteNodes = defineAgentTool({
    name: 'delete_canvas_nodes', version: 1, title: '删除画布节点',
    description: '删除明确的画布节点及其关联边；操作可通过返回的 undoRef 撤销，项目删除使用单独的高风险工具。', category: 'canvas', side: 'frontend',
    risk: 'R2', permission: 'canvas:write', readOnly: false, destructive: true, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(1).max(50) }).strict(),
    outputSchema: z.object({ projectId: z.string(), deletedNodeIds: z.array(z.string()), undoRef: z.string(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, required: ['projectId', 'nodeIds'], additionalProperties: false },
    preview: (input) => ({ title: '删除画布节点', summary: `删除 ${input.nodeIds.length} 个节点及关联边。`, targetIds: { projectId: input.projectId, nodeIds: input.nodeIds.join(',') }, reversible: true, dataClasses: ['C1'] }),
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'delete_canvas_nodes', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId, nodeIds: input.nodeIds.join(',') }), dataClasses: () => ['C1'],
    summarize: (output) => `已删除 ${Array.isArray(output.deletedNodeIds) ? output.deletedNodeIds.length : 0} 个画布节点。`,
  })

  const selectNode = defineAgentTool({
    name: 'select_canvas_node', version: 1, title: '选择画布节点',
    description: '在明确项目中选择或清除一个节点，不改变画布数据。', category: 'canvas', side: 'frontend',
    risk: 'R0', permission: 'canvas:selection', readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1).nullable() }).strict(),
    outputSchema: z.object({ projectId: z.string(), selectedNodeId: z.string().nullable(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeId: { type: ['string', 'null'] } }, required: ['projectId', 'nodeId'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'select_canvas_node', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}:selection`, targetIds: (input) => ({ projectId: input.projectId, nodeId: input.nodeId ?? '' }), dataClasses: () => ['C0'],
    summarize: (output) => `当前选中节点：${String(output.selectedNodeId ?? '无')}。`,
  })

  const groupNodes = defineAgentTool({
    name: 'group_canvas_nodes', version: 1, title: '组合画布节点',
    description: '把明确的两个或多个节点放入一个组节点，返回可撤销引用。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:write', readOnly: false, destructive: false, openWorld: false, idempotent: false,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(2).max(50) }).strict(),
    outputSchema: z.object({ projectId: z.string(), groupNodeId: z.string(), undoRef: z.string(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 50 } }, required: ['projectId', 'nodeIds'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'group_canvas_nodes', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId, nodeIds: input.nodeIds.join(',') }), dataClasses: () => ['C1'],
    summarize: (output) => `已创建节点组 ${String(output.groupNodeId)}。`,
  })

  const disconnectEdge = defineAgentTool({
    name: 'disconnect_canvas_edge', version: 1, title: '断开画布连接',
    description: '断开明确 edgeId 的画布连接；不接受根据节点名称猜边。', category: 'canvas', side: 'frontend',
    risk: 'R1', permission: 'canvas:write', readOnly: false, destructive: true, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), edgeId: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string(), edgeId: z.string(), undoRef: z.string(), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' }, edgeId: { type: 'string' } }, required: ['projectId', 'edgeId'], additionalProperties: false },
    execute: async (input, context) => requireFrontendSuccess(await invoke({ kind: 'command', command: { name: 'disconnect_canvas_edge', input, expectedRevisions: canvasExpectedRevision(context) } }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`, targetIds: (input) => ({ projectId: input.projectId, edgeId: input.edgeId }), dataClasses: () => ['C1'],
    summarize: (output) => `已断开画布连接 ${String(output.edgeId)}。`,
  })

  return [
    eraseToolDefinition(duplicateNode),
    eraseToolDefinition(updateNode),
    eraseToolDefinition(deleteNodes),
    eraseToolDefinition(selectNode),
    eraseToolDefinition(groupNodes),
    eraseToolDefinition(disconnectEdge),
  ]
}
