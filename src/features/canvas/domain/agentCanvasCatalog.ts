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
  validateGenerationData(data, 'image')
}

function validateGenerationData(
  data: Record<string, unknown>,
  expectedMediaType: 'image' | 'video' | 'audio'
): void {
  if (typeof data.modelId !== 'string') return
  const model = registry.getModel(data.modelId)
  if (!model || model.meta.type !== expectedMediaType) {
    throw new Error(`画布生成节点只能使用已注册的${expectedMediaType}模型`)
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

function validateModelSelectorData(
  data: Record<string, unknown>,
  expectedMediaType: 'image' | 'video' | 'audio'
): void {
  if (typeof data.modelId !== 'string') return
  const model = registry.getModel(data.modelId)
  if (!model || model.meta.type !== expectedMediaType) {
    throw new Error(`模型选择器只能输出已注册的${expectedMediaType}模型`)
  }
}

const textAnnotationNodeDataSchema = nodeDataBaseSchema.extend({
  content: z.string().max(32 * 1024).optional(),
}).strict()

const generationNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()

const storyboardGenerationNodeDataSchema = generationNodeDataSchema.extend({
  gridRows: z.number().int().min(1).max(8).optional(),
  gridCols: z.number().int().min(1).max(8).optional(),
}).strict()

const numberSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.number().finite().optional() }).strict()
const stringSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.string().max(32 * 1024).optional() }).strict()
const booleanSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.boolean().optional() }).strict()
const modelSelectorNodeDataSchema = nodeDataBaseSchema.extend({ modelId: z.string().min(1).optional() }).strict()

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
  {
    nodeType: CANVAS_NODE_TYPES.videoGen,
    title: 'AI 视频生成节点',
    description: '创建配置驱动的视频生成节点；模型与参数必须来自目录和 schema。',
    dataSchema: generationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, prompt: { type: 'string', maxLength: 32768 }, modelId: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data) => validateGenerationData(data, 'video'),
  },
  {
    nodeType: CANVAS_NODE_TYPES.audioGen,
    title: 'AI 音频生成节点',
    description: '创建配置驱动的音频生成节点；模型与参数必须来自目录和 schema。',
    dataSchema: generationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, prompt: { type: 'string', maxLength: 32768 }, modelId: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data) => validateGenerationData(data, 'audio'),
  },
  {
    nodeType: CANVAS_NODE_TYPES.storyboardGen,
    title: '分镜生成节点',
    description: '创建分镜生成节点；格子内容仍由节点自身的受控编辑流程维护。',
    dataSchema: storyboardGenerationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' }, params: { type: 'object', additionalProperties: true }, gridRows: { type: 'integer', minimum: 1, maximum: 8 }, gridCols: { type: 'integer', minimum: 1, maximum: 8 } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: validateImageGenerationData,
  },
  {
    nodeType: CANVAS_NODE_TYPES.textAnnotation,
    title: '文字注释节点',
    description: '创建可编辑的画布文字注释。',
    dataSchema: textAnnotationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, content: { type: 'string', maxLength: 32768 } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.videoUpload,
    title: '上传视频节点',
    description: '创建等待用户通过受控上传流程选择视频的输入节点。',
    dataSchema: uploadNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.audioUpload,
    title: '上传音频节点',
    description: '创建等待用户通过受控上传流程选择音频的输入节点。',
    dataSchema: uploadNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.cameraStage,
    title: '3D 运镜节点',
    description: '创建可关联独立 3D 运镜工程的画布节点。',
    dataSchema: uploadNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.intSource,
    title: '整数参数节点',
    description: '向兼容参数端口提供整数值。',
    dataSchema: numberSourceNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, value: { type: 'number' } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.floatSource,
    title: '浮点参数节点',
    description: '向兼容参数端口提供浮点值。',
    dataSchema: numberSourceNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, value: { type: 'number' } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.stringSource,
    title: '文本参数节点',
    description: '向兼容参数端口提供文本值。',
    dataSchema: stringSourceNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, value: { type: 'string', maxLength: 32768 } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.booleanSource,
    title: '布尔参数节点',
    description: '向兼容参数端口提供开关值。',
    dataSchema: booleanSourceNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, value: { type: 'boolean' } }, additionalProperties: false },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.imageModelSelector,
    title: '图片模型选择器',
    description: '向兼容模型端口输出图片模型标识。',
    dataSchema: modelSelectorNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data) => validateModelSelectorData(data, 'image'),
  },
  {
    nodeType: CANVAS_NODE_TYPES.videoModelSelector,
    title: '视频模型选择器',
    description: '向兼容模型端口输出视频模型标识。',
    dataSchema: modelSelectorNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data) => validateModelSelectorData(data, 'video'),
  },
  {
    nodeType: CANVAS_NODE_TYPES.audioModelSelector,
    title: '音频模型选择器',
    description: '向兼容模型端口输出音频模型标识。',
    dataSchema: modelSelectorNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data) => validateModelSelectorData(data, 'audio'),
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

export function extractAgentCanvasNodeData(
  nodeType: string,
  data: Record<string, unknown>
): Partial<CanvasNodeData> {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const properties = (config.aiDataSchema.properties ?? {}) as Record<string, unknown>
  const supported = Object.fromEntries(Object.entries(data).filter(([key]) => key in properties))
  const parsed = config.dataSchema.parse(supported)
  config.validateData?.(parsed)
  return parsed as Partial<CanvasNodeData>
}
