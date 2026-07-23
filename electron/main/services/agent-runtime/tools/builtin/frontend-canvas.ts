import { z } from 'zod'

import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import {
  eraseToolDefinition,
  expectedRevision,
  requireFrontendSuccess,
  type FrontendToolInvoker,
} from './frontend-utils'

const scopeRevisionsSchema = z.record(z.string(), z.number())
const revisionOutput = {
  revision: z.number().int().nonnegative(),
  scopeRevisions: scopeRevisionsSchema,
}

const placementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('viewport_center') }).strict(),
  z.object({ mode: z.literal('right_of_node'), anchorNodeId: z.string().min(1) }).strict(),
])

export function createFrontendCanvasTools(invoke: FrontendToolInvoker): AgentToolDefinition[] {
  const listProjects = defineAgentTool({
    name: 'list_canvas_projects', version: 1, title: '列出画布项目',
    description: '列出可供明确选择的画布项目摘要，不读取完整节点数据。',
    category: 'canvas', side: 'frontend', risk: 'R0', permission: 'canvas:read',
    readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 },
    supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ projects: z.array(z.record(z.string(), z.unknown())), ...revisionOutput }).passthrough(),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, context) => requireFrontendSuccess(await invoke({
      kind: 'query', query: { name: 'list_canvas_projects', input: {} },
    }, context)),
    concurrencyKey: () => 'canvas_catalog', targetIds: () => ({}), dataClasses: () => ['C1'],
    summarize: (output) => `画布项目目录返回 ${Array.isArray(output.projects) ? output.projects.length : 0} 项。`,
  })

  const openProject = defineAgentTool({
    name: 'open_canvas_project', version: 1, title: '打开画布项目',
    description: '按明确 projectId 打开画布项目并进入画布工作区。',
    category: 'canvas', side: 'frontend', risk: 'R1', permission: 'canvas:open',
    readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 15_000, retryPolicy: { maxRetries: 1, baseDelayMs: 150 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['navigation', 'canvas'],
    inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string().min(1), ...revisionOutput }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'command',
      command: {
        name: 'open_canvas_project', input,
        expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['navigation', 'canvas']),
      },
    }, context)),
    concurrencyKey: () => 'canvas_project', targetIds: (input) => ({ projectId: input.projectId }),
    dataClasses: () => ['C1'], summarize: (output) => `已打开画布项目 ${output.projectId}。`,
  })

  const searchNodeTypes = defineAgentTool({
    name: 'search_canvas_node_types', version: 1, title: '搜索画布节点类型',
    description: '搜索本阶段允许 Agent 创建的画布节点目录；必须先查目录再读取单项 schema。',
    category: 'canvas', side: 'frontend', risk: 'R0', permission: 'canvas_catalog:read',
    readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 },
    supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({
      query: z.string().max(500).default(''), cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }).strict(),
    outputSchema: z.object({
      catalogVersion: z.string(), nodeTypes: z.array(z.record(z.string(), z.unknown())),
      nextCursor: z.number().int().nonnegative().nullable(), ...revisionOutput,
    }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: {
        query: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 },
      }, additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'query', query: { name: 'search_canvas_node_types', input },
    }, context)),
    concurrencyKey: () => 'canvas_catalog', targetIds: () => ({}), dataClasses: () => ['C0'],
    summarize: (output) => `画布节点目录返回 ${Array.isArray(output.nodeTypes) ? output.nodeTypes.length : 0} 项。`,
  })

  const getNodeSchema = defineAgentTool({
    name: 'get_canvas_node_schema', version: 1, title: '读取画布节点结构',
    description: '读取单个画布节点类型的数据、端口和连接 schema，禁止凭名称猜参数。',
    category: 'canvas', side: 'frontend', risk: 'R0', permission: 'canvas_catalog:read',
    readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 },
    supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ nodeType: z.string().min(1) }).strict(),
    outputSchema: z.object({ schema: z.record(z.string(), z.unknown()), ...revisionOutput }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: { nodeType: { type: 'string' } }, required: ['nodeType'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'query', query: { name: 'get_canvas_node_schema', input },
    }, context)),
    concurrencyKey: (input) => `canvas_schema:${input.nodeType}`,
    targetIds: (input) => ({ nodeType: input.nodeType }), dataClasses: () => ['C0'],
    summarize: (output) => `已读取节点 ${String((output.schema as Record<string, unknown>).nodeType ?? '')} 的结构。`,
  })

  const addNode = defineAgentTool({
    name: 'add_canvas_node', version: 1, title: '添加画布节点',
    description: '在明确项目中按确定性布局添加已通过目录/schema 校验的节点，不接受像素拖拽轨迹。',
    category: 'canvas', side: 'frontend', risk: 'R1', permission: 'canvas:write',
    readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({
      projectId: z.string().min(1), nodeType: z.string().min(1), placement: placementSchema,
      data: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
    outputSchema: z.object({
      projectId: z.string(), nodeId: z.string(), nodeType: z.string(), undoRef: z.string(), ...revisionOutput,
    }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: {
        projectId: { type: 'string' }, nodeType: { type: 'string' },
        placement: {
          type: 'object', properties: {
            mode: { type: 'string', enum: ['viewport_center', 'right_of_node'] }, anchorNodeId: { type: 'string' },
          }, required: ['mode'], additionalProperties: false,
        },
        data: { type: 'object', additionalProperties: true },
      }, required: ['projectId', 'nodeType', 'placement'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'command', command: {
        name: 'add_canvas_node', input,
        expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
      },
    }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`,
    targetIds: (input) => ({ projectId: input.projectId, nodeType: input.nodeType }), dataClasses: () => ['C1'],
    summarize: (output) => `已在项目 ${output.projectId} 添加节点 ${output.nodeId}。`,
    undo: (output) => ({ kind: 'canvas_history', token: String(output.undoRef) }),
  })

  const connectNodes = defineAgentTool({
    name: 'connect_canvas_nodes', version: 1, title: '连接画布节点',
    description: '连接明确的上下游节点；宿主按节点注册表解析端口并拒绝不兼容、重复或循环连接。',
    category: 'canvas', side: 'frontend', risk: 'R1', permission: 'canvas:write',
    readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: true, requiredContext: ['canvas'],
    inputSchema: z.object({
      projectId: z.string().min(1), sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1),
    }).strict(),
    outputSchema: z.object({
      projectId: z.string(), edgeId: z.string(), sourceNodeId: z.string(), targetNodeId: z.string(),
      undoRef: z.string(), ...revisionOutput,
    }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: {
        projectId: { type: 'string' }, sourceNodeId: { type: 'string' }, targetNodeId: { type: 'string' },
      }, required: ['projectId', 'sourceNodeId', 'targetNodeId'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'command', command: {
        name: 'connect_canvas_nodes', input,
        expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
      },
    }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`,
    targetIds: (input) => ({ projectId: input.projectId, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId }),
    dataClasses: () => ['C1'], summarize: (output) => `已创建画布连接 ${output.edgeId}。`,
    undo: (output) => ({ kind: 'canvas_history', token: String(output.undoRef) }),
  })

  const focusNode = defineAgentTool({
    name: 'focus_canvas_node', version: 1, title: '定位画布节点',
    description: '进入画布工作区，选中并把明确 nodeId 定位到可视区域。',
    category: 'canvas', side: 'frontend', risk: 'R0', permission: 'canvas:focus',
    readOnly: false, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['navigation', 'canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string(), nodeId: z.string(), focused: z.boolean(), ...revisionOutput }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: { projectId: { type: 'string' }, nodeId: { type: 'string' } },
      required: ['projectId', 'nodeId'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'command', command: {
        name: 'focus_canvas_node', input,
        expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['navigation', 'canvas']),
      },
    }, context)),
    concurrencyKey: () => 'canvas_focus', targetIds: (input) => ({ projectId: input.projectId, nodeId: input.nodeId }),
    dataClasses: () => ['C1'], summarize: (output) => `已定位画布节点 ${output.nodeId}。`,
  })

  const undoChange = defineAgentTool({
    name: 'undo_canvas_change', version: 1, title: '撤销画布操作',
    description: '使用上一条 Agent 画布写操作返回的 undoRef 做后进先出撤销；画布变化后旧引用失效。',
    category: 'canvas', side: 'frontend', risk: 'R1', permission: 'canvas:undo',
    readOnly: false, destructive: true, openWorld: false, idempotent: true,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
    inputSchema: z.object({ projectId: z.string().min(1), undoRef: z.string().min(1) }).strict(),
    outputSchema: z.object({ projectId: z.string(), undoRef: z.string(), operation: z.string(), status: z.literal('undone'), ...revisionOutput }).passthrough(),
    aiInputSchema: {
      type: 'object', properties: { projectId: { type: 'string' }, undoRef: { type: 'string' } },
      required: ['projectId', 'undoRef'], additionalProperties: false,
    },
    execute: async (input, context) => requireFrontendSuccess(await invoke({
      kind: 'command', command: {
        name: 'undo_canvas_change', input,
        expectedRevisions: expectedRevision(context.hostContext?.scopeRevisions, ['canvas']),
      },
    }, context)),
    concurrencyKey: (input) => `canvas:${input.projectId}`,
    targetIds: (input) => ({ projectId: input.projectId, undoRef: input.undoRef }), dataClasses: () => ['C1'],
    summarize: (output) => `已撤销画布操作 ${output.operation}。`,
  })

  return [
    eraseToolDefinition(listProjects),
    eraseToolDefinition(openProject),
    eraseToolDefinition(searchNodeTypes),
    eraseToolDefinition(getNodeSchema),
    eraseToolDefinition(addNode),
    eraseToolDefinition(connectNodes),
    eraseToolDefinition(focusNode),
    eraseToolDefinition(undoChange),
  ]
}
