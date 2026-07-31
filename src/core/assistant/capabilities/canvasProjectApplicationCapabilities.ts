import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import {
  capabilityOutputSchema,
  defineApplicationCapability,
} from './defineApplicationCapability'

function projectTarget(projectId: string): Record<string, string> {
  return { projectId }
}

const listCanvasProjects = defineApplicationCapability({
  id: 'list_canvas_projects',
  version: 1,
  title: '列出画布项目',
  description: '列出可供明确选择的画布项目摘要，不读取完整节点数据。',
  domain: 'canvas',
  aliases: ['画布项目', '已有画布', 'list canvas projects'],
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  producesRefs: ['canvas.project'],
  inputSchema: z.object({}).strict(),
  outputSchema: capabilityOutputSchema({
    projects: z.array(z.record(z.string(), z.unknown())),
  }),
  concurrencyKey: 'canvas_catalog',
  summarize: (output) => `画布项目目录返回 ${output.projects.length} 项。`,
})

const openCanvasProject = defineApplicationCapability({
  id: 'open_canvas_project',
  version: 1,
  title: '打开画布项目',
  description: '按明确项目引用打开画布项目并进入画布工作区。',
  domain: 'canvas',
  aliases: ['进入画布项目', 'open canvas project'],
  readOnly: false,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'canvas:open',
  idempotent: true,
  destructive: false,
  timeoutMs: 15_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation', 'canvas'],
  acceptsRefs: ['canvas.project'],
  producesRefs: ['canvas.project', 'application.surface'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string().min(1) }),
  concurrencyKey: 'canvas_project',
  resolveTargetIds: (input) => projectTarget(input.projectId),
  summarize: (output) => `已打开画布项目 ${output.projectId}。`,
})

const searchCanvasNodeTypes = defineApplicationCapability({
  id: 'search_canvas_node_types',
  version: 1,
  title: '搜索画布节点类型',
  description: '搜索允许创建的画布节点目录，创建前应先读取目标节点结构。',
  domain: 'canvas',
  aliases: ['画布节点类型', '节点目录', 'search canvas nodes'],
  readOnly: true,
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
  summarize: (output) => `已读取节点 ${String(output.schema.nodeType ?? '')} 的结构。`,
})

const createCanvasProject = defineApplicationCapability({
  id: 'create_canvas_project',
  version: 1,
  title: '新建画布项目',
  description: '创建空画布项目并进入画布工作区。',
  domain: 'canvas',
  aliases: ['创建画布', 'new canvas project'],
  readOnly: false,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'canvas:project_write',
  idempotent: false,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  producesRefs: ['canvas.project', 'application.surface'],
  inputSchema: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  outputSchema: capabilityOutputSchema({
    projectId: z.string().min(1),
    name: z.string().min(1),
  }),
  concurrencyKey: 'canvas_project',
  resolveTargetIds: (input) => ({ name: input.name }),
  summarize: (output) => `已创建画布项目 ${output.projectId}。`,
})

function defineProjectWrite(
  id: 'close_canvas_project' | 'rename_canvas_project',
  title: string,
  description: string,
  withName: boolean
): ApplicationCapabilityDefinition {
  const inputSchema = withName
    ? z.object({
        projectId: z.string().min(1),
        name: z.string().trim().min(1).max(120),
      }).strict()
    : z.object({ projectId: z.string().min(1) }).strict()
  return defineApplicationCapability({
    id,
    version: 1,
    title,
    description,
    domain: 'canvas',
    aliases: [title, id.replaceAll('_', ' ')],
    readOnly: false,
    risk: 'R1',
    dataClasses: ['C1'],
    permission: 'canvas:project_write',
    idempotent: true,
    destructive: false,
    timeoutMs: 8_000,
    supportsPreview: false,
    supportsUndo: false,
    requiredScopes: ['canvas'],
    acceptsRefs: ['canvas.project'],
    producesRefs: ['canvas.project'],
    inputSchema,
    outputSchema: capabilityOutputSchema({
      projectId: z.string().min(1),
      ...(withName
        ? { name: z.string().min(1) }
        : { status: z.literal('closed') }),
    }),
    concurrencyKey: 'canvas_project',
    resolveConcurrencyKey: (input) => `canvas:${input.projectId}`,
    resolveTargetIds: (input) => projectTarget(input.projectId),
    summarize: (output) => withName && 'name' in output
      ? `已将画布项目重命名为 ${String(output.name)}。`
      : `已关闭画布项目 ${String(output.projectId)}。`,
  })
}

const deleteCanvasProject = defineApplicationCapability({
  id: 'delete_canvas_project',
  version: 1,
  title: '删除画布项目',
  description: '删除明确画布项目及其持久化画布数据。',
  domain: 'canvas',
  aliases: ['永久删除画布', 'delete canvas project'],
  readOnly: false,
  risk: 'R3',
  dataClasses: ['C1'],
  permission: 'canvas:project_delete',
  idempotent: true,
  destructive: true,
  timeoutMs: 10_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.project'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({
    projectId: z.string().min(1),
    status: z.literal('deleted'),
  }),
  concurrencyKey: 'canvas_project',
  resolveConcurrencyKey: (input) => `canvas:${input.projectId}`,
  resolveTargetIds: (input) => projectTarget(input.projectId),
  preview: (input) => ({
    title: '删除画布项目',
    summary: `永久删除项目 ${input.projectId} 及其画布数据。`,
    targetIds: projectTarget(input.projectId),
    reversible: false,
    dataClasses: ['C1'],
  }),
  summarize: (output) => `已删除画布项目 ${output.projectId}。`,
})

const getCanvasProject = defineApplicationCapability({
  id: 'get_canvas_project',
  version: 1,
  title: '读取画布项目详情',
  description: '读取明确画布项目的节点和连接摘要，不返回大媒体或完整画布数据。',
  domain: 'canvas',
  aliases: ['画布项目详情', 'get canvas project'],
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.project'],
  producesRefs: ['canvas.project', 'canvas.node', 'canvas.edge'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({
    project: z.record(z.string(), z.unknown()),
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
    truncated: z.boolean(),
  }),
  concurrencyKey: 'canvas_project',
  resolveConcurrencyKey: (input) => `canvas_project:${input.projectId}`,
  resolveTargetIds: (input) => projectTarget(input.projectId),
  summarize: (output) => `画布项目包含 ${output.nodes.length} 个节点。`,
})

const getCanvasNode = defineApplicationCapability({
  id: 'get_canvas_node',
  version: 1,
  title: '读取画布节点详情',
  description: '读取明确节点的配置摘要与相邻连接，媒体原文只返回引用存在性。',
  domain: 'canvas',
  aliases: ['画布节点详情', 'get canvas node'],
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.project', 'canvas.node'],
  producesRefs: ['canvas.node', 'canvas.edge'],
  inputSchema: z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    node: z.record(z.string(), z.unknown()),
    connectedEdges: z.array(z.record(z.string(), z.unknown())),
  }),
  concurrencyKey: 'canvas_node',
  resolveConcurrencyKey: (input) => `canvas_node:${input.nodeId}`,
  resolveTargetIds: (input) => ({
    projectId: input.projectId,
    nodeId: input.nodeId,
  }),
  summarize: (output) => `已读取画布节点 ${String(output.node.id ?? '')}。`,
})

export const CANVAS_PROJECT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  listCanvasProjects,
  openCanvasProject,
  searchCanvasNodeTypes,
  getCanvasNodeSchema,
  createCanvasProject,
  defineProjectWrite('close_canvas_project', '关闭画布项目', '保存并关闭明确的当前画布项目。', false),
  defineProjectWrite('rename_canvas_project', '重命名画布项目', '重命名明确的画布项目。', true),
  deleteCanvasProject,
  getCanvasProject,
  getCanvasNode,
]
