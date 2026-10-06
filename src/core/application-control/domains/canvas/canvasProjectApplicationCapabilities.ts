import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from '../shared/defineApplicationCapability'
import { canvasDocumentIdSchema } from './canvasDocumentId'

/*
 * 画布内容能力（3.4 起画布是 `.henji-canvas` 文档）：画布的列出、新建、打开、改名、移动、副本、回收站
 * 都由通用文档能力承担（list_documents / create_document / open_document / documents.document.name …），
 * 这里只留读取画布内容与保存恢复。documentId 一律是画布文档 ID（取自 list_documents，kind=canvas），不是所在项目 ID。
 */


function documentTarget(documentId: string): Record<string, string> {
  return { documentId }
}

const searchCanvasNodeTypes = defineApplicationCapability({
  id: 'search_canvas_node_types',
  version: 1,
  title: '搜索画布节点类型',
  description: '搜索允许创建的画布节点目录，创建前应先读取目标节点结构。',
  domain: 'canvas',
  aliases: ['画布节点类型', '节点目录', 'search canvas nodes'],
  readOnly: true,
  control: capabilityControl('observe', ['canvas.node_type']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'canvas_catalog:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  producesRefs: ['canvas.node_type'],
  inputSchema: z.object({
    query: z.string().max(500).default(''),
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(20).default(10),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    catalogVersion: z.string(),
    nodeTypes: z.array(z.record(z.string(), z.unknown())),
    nextCursor: z.number().int().nonnegative().nullable(),
  }),
  concurrencyKey: 'canvas_catalog',
  resolveObservedEffects: (_input, output) => {
    const refs = output.nodeTypes.flatMap((item) => (
      typeof item.nodeType === 'string' && item.nodeType
        ? [{ kind: 'canvas.node_type', id: item.nodeType }]
        : []
    ))
    return [{
      effect: 'observe', entityTypes: ['canvas.node_type'], propertyIds: [],
      targetRefs: refs, count: Math.max(1, refs.length), verified: true,
      evidence: [`catalog:${output.catalogVersion}`],
    }]
  },
  summarize: (output) => `画布节点目录返回 ${output.nodeTypes.length} 项。`,
})

const getCanvasNodeSchema = defineApplicationCapability({
  id: 'get_canvas_node_schema',
  version: 1,
  title: '读取画布节点结构',
  description: '读取单个画布节点类型的数据、端口和连接结构。',
  domain: 'canvas',
  aliases: ['节点参数结构', '节点端口', 'get canvas node schema'],
  readOnly: true,
  control: capabilityControl('observe', ['canvas.node_type']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'canvas_catalog:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  acceptsRefs: ['canvas.node_type'],
  producesRefs: ['canvas.node_type'],
  inputSchema: z.object({ nodeType: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({
    schema: z.record(z.string(), z.unknown()),
  }),
  concurrencyKey: 'canvas_schema',
  resolveConcurrencyKey: (input) => `canvas_schema:${input.nodeType}`,
  resolveTargetIds: (input) => ({ nodeType: input.nodeType }),
  resolveObservedEffects: (input) => [{
    effect: 'observe', entityTypes: ['canvas.node_type'], propertyIds: [],
    targetRefs: [{ kind: 'canvas.node_type', id: input.nodeType }],
    count: 1, verified: true, evidence: [`node_type:${input.nodeType}`],
  }],
  summarize: (output) => `已读取节点 ${String(output.schema.nodeType ?? '')} 的结构。`,
})

const getCanvasDocument = defineApplicationCapability({
  id: 'get_canvas_document',
  version: 1,
  title: '读取画布详情',
  description: '读取明确画布文档的节点和连接摘要，不返回大媒体或完整画布数据。',
  domain: 'canvas',
  aliases: ['画布详情', '画布内容', 'get canvas document'],
  readOnly: true,
  control: capabilityControl('observe', ['canvas.document', 'canvas.node', 'canvas.edge']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.document'],
  producesRefs: ['canvas.document', 'canvas.node', 'canvas.edge'],
  inputSchema: z.object({ documentId: canvasDocumentIdSchema }).strict(),
  outputSchema: capabilityOutputSchema({
    document: z.record(z.string(), z.unknown()),
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
    truncated: z.boolean(),
  }),
  concurrencyKey: 'canvas_document',
  resolveConcurrencyKey: (input) => `canvas_document:${input.documentId}`,
  resolveTargetIds: (input) => documentTarget(input.documentId),
  resolveObservedEffects: (input, output) => {
    const recordId = (value: Record<string, unknown>): string | null => (
      typeof value.id === 'string' && value.id ? value.id : null
    )
    const refs = [
      { kind: 'canvas.document', id: input.documentId },
      ...output.nodes.flatMap((node) => {
        const id = recordId(node)
        return id ? [{ kind: 'canvas.node', id }] : []
      }),
      ...output.edges.flatMap((edge) => {
        const id = recordId(edge)
        return id ? [{ kind: 'canvas.edge', id }] : []
      }),
    ]
    return [{
      effect: 'observe', entityTypes: ['canvas.document', 'canvas.node', 'canvas.edge'],
      propertyIds: [], targetRefs: refs, count: Math.max(1, refs.length), verified: true,
      evidence: [`canvas:${input.documentId}`],
    }]
  },
  summarize: (output) => `画布包含 ${output.nodes.length} 个节点。`,
})

const getCanvasNode = defineApplicationCapability({
  id: 'get_canvas_node',
  version: 1,
  title: '读取画布节点详情',
  description: '读取明确节点的配置摘要与相邻连接，媒体原文只返回引用存在性。',
  domain: 'canvas',
  aliases: ['画布节点详情', 'get canvas node'],
  readOnly: true,
  control: capabilityControl('observe', ['canvas.node', 'canvas.edge']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.document', 'canvas.node'],
  producesRefs: ['canvas.node', 'canvas.edge'],
  inputSchema: z.object({
    documentId: canvasDocumentIdSchema,
    nodeId: z.string().min(1),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    node: z.record(z.string(), z.unknown()),
    connectedEdges: z.array(z.record(z.string(), z.unknown())),
  }),
  concurrencyKey: 'canvas_node',
  resolveConcurrencyKey: (input) => `canvas_node:${input.nodeId}`,
  resolveTargetIds: (input) => ({
    documentId: input.documentId,
    nodeId: input.nodeId,
  }),
  summarize: (output) => `已读取画布节点 ${String(output.node.id ?? '')}。`,
})

const retryCanvasProjectSave = defineApplicationCapability({
  id: 'retry_canvas_document_save',
  external: { kind: 'recovery', reason: '仅保存恢复入口，必须绑定原失败操作与原编辑会话，只能由 retry_application_operation_save 按账本触发。' },
  version: 1,
  title: '重试保存画布',
  description: '保存当前画布中已发生的修改并等待存储确认，不重复新增、删除、撤销或其他业务操作。',
  domain: 'canvas', aliases: ['重试保存', '画布保存失败', 'retry canvas save'],
  readOnly: false,
  control: capabilityControl('execute', ['canvas.document'], { revisionScopes: ['canvas'] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'canvas:write',
  idempotent: true, destructive: false, timeoutMs: 15_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.document'], producesRefs: ['canvas.document'],
  successEvidence: ['当前画布已经由正式存储确认；节点、连线及撤销历史没有再次执行。'],
  failureRecovery: ['保存失败时保留当前编辑，再次调用本能力；已切换到别的画布时先检查并返回原画布。'],
  inputSchema: z.object({ documentRef: z.object({ kind: z.literal('canvas.document'), id: z.string().min(1) }).strict() }).strict(),
  outputSchema: capabilityOutputSchema({
    ref: z.object({ kind: z.literal('canvas.document'), id: z.string().min(1) }).strict(),
    status: z.literal('persisted'),
  }),
  concurrencyKey: 'canvas_document',
  resolveConcurrencyKey: (input) => `canvas:${input.documentRef.id}`,
  resolveTargetIds: (input) => documentTarget(input.documentRef.id),
  summarize: () => '画布修改已保存，未重复执行原操作。',
})

export const CANVAS_PROJECT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  retryCanvasProjectSave,
  searchCanvasNodeTypes,
  getCanvasNodeSchema,
  getCanvasDocument,
  getCanvasNode,
]
