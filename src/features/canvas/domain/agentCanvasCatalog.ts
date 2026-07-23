import { z } from 'zod'

import { registry } from '@/core/ModelRegistry'
import { validateParamValue } from '@/core/request'

import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
} from './canvasNodes'
import {
  getCanvasNodeDefinition,
  type CanvasNodeDefinition,
} from './nodeRegistry'

export const AGENT_CANVAS_CATALOG_VERSION = 'canvas-agent-node-catalog/v1' as const

const nodeDataBaseSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
})

const uploadNodeDataSchema = nodeDataBaseSchema.strict()

const imageGenerationNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()

interface AgentCanvasNodeConfig {
  nodeType: CanvasNodeType
  title: string
  description: string
  dataSchema: z.ZodType<Record<string, unknown>>
  aiDataSchema: Record<string, unknown>
  requiresModelSchema: boolean
  validateData?: (data: Record<string, unknown>) => void
}

function validateImageGenerationData(data: Record<string, unknown>): void {
  if (typeof data.modelId !== 'string') return
  const model = registry.getModel(data.modelId)
  if (!model || model.meta.type !== 'image') {
    throw new Error('画布图片生成节点只能使用已注册的图片模型')
  }
  if (!data.params || typeof data.params !== 'object' || Array.isArray(data.params)) return
  const params = data.params as Record<string, unknown>
  const schemaById = new Map(model.params.map((param) => [param.id, param]))
  for (const [paramId, value] of Object.entries(params)) {
    const param = schemaById.get(paramId)
    if (!param || !validateParamValue(param, value)) {
      throw new Error(`模型参数无效：${paramId}`)
    }
  }
}

const agentNodeConfigs: AgentCanvasNodeConfig[] = [
  {
    nodeType: CANVAS_NODE_TYPES.upload,
    title: '上传图片节点',
    description: '创建一个由用户后续选择图片的输入节点；Agent 不能填入任意本地路径。',
    dataSchema: uploadNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.imageEdit,
    title: 'AI 图片生成节点',
    description: '创建配置驱动的图片生成节点；modelId 和 params 必须来自模型目录与模型 schema。',
    dataSchema: imageGenerationNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 120 },
        prompt: { type: 'string', maxLength: 32 * 1024 },
        modelId: { type: 'string' },
        params: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    requiresModelSchema: true,
    validateData: validateImageGenerationData,
  },
]

const configByType = new Map(agentNodeConfigs.map((config) => [config.nodeType, config]))

export interface AgentCanvasNodeCatalogEntry {
  nodeType: CanvasNodeType
  title: string
  description: string
  menuLabelKey: string
  media: CanvasNodeDefinition['media']
  supportsInput: boolean
  supportsOutput: boolean
  requiresModelSchema: boolean
}

export interface AgentCanvasNodeSchema {
  schemaVersion: typeof AGENT_CANVAS_CATALOG_VERSION
  nodeType: CanvasNodeType
  title: string
  description: string
  menuLabelKey: string
  dataSchema: Record<string, unknown>
  defaultData: Record<string, unknown>
  connectivity: CanvasNodeDefinition['connectivity']
  ports: CanvasNodeDefinition['ports']
  requiresModelSchema: boolean
}

function toCatalogEntry(config: AgentCanvasNodeConfig): AgentCanvasNodeCatalogEntry {
  const definition = getCanvasNodeDefinition(config.nodeType)
  if (!definition) throw new Error(`画布节点定义不存在：${config.nodeType}`)
  return {
    nodeType: config.nodeType,
    title: config.title,
    description: config.description,
    menuLabelKey: definition.menuLabelKey,
    media: definition.media,
    supportsInput: definition.connectivity.targetHandle,
    supportsOutput: definition.connectivity.sourceHandle,
    requiresModelSchema: config.requiresModelSchema,
  }
}

export function searchAgentCanvasNodeTypes(query: string): AgentCanvasNodeCatalogEntry[] {
  const normalized = query.trim().toLowerCase()
  return agentNodeConfigs
    .filter((config) => !normalized || `${config.nodeType} ${config.title} ${config.description}`.toLowerCase().includes(normalized))
    .map(toCatalogEntry)
}

export function getAgentCanvasNodeSchema(nodeType: string): AgentCanvasNodeSchema | null {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) return null
  const definition = getCanvasNodeDefinition(config.nodeType)
  if (!definition) return null
  return {
    schemaVersion: AGENT_CANVAS_CATALOG_VERSION,
    nodeType: config.nodeType,
    title: config.title,
    description: config.description,
    menuLabelKey: definition.menuLabelKey,
    dataSchema: config.aiDataSchema,
    defaultData: definition.createDefaultData() as Record<string, unknown>,
    connectivity: definition.connectivity,
    ports: definition.ports,
    requiresModelSchema: config.requiresModelSchema,
  }
}

export function parseAgentCanvasNodeData(
  nodeType: string,
  input: Record<string, unknown> | undefined
): { nodeType: CanvasNodeType; data: Partial<CanvasNodeData> } {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const data = config.dataSchema.parse(input ?? {})
  config.validateData?.(data)
  return { nodeType: config.nodeType, data: data as Partial<CanvasNodeData> }
}
