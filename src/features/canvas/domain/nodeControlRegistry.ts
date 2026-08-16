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
import { modelPortId, promptPortId } from './socketTypes'

export const CANVAS_NODE_CONTROL_CATALOG_VERSION = 'canvas-node-control/v1' as const

const nodeDataBaseSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
})

const uploadNodeDataSchema = nodeDataBaseSchema.strict()

/*
 * 面向助手的 upload schema 刻意不接收媒体路径：否则模型可以绕过素材库，把任意本地路径
 * 塞进画布节点。素材库导入则已经先通过 assetApplicationService.inspect 锚定为正式素材，
 * 需要一条独立的窄通道承载这份受信任媒体数据，不能为了修复导入而放宽公共 schema。
 */
const trustedImageUploadNodeDataSchema = nodeDataBaseSchema.extend({
  imageUrl: z.string().min(1).max(16 * 1024),
  previewImageUrl: z.string().min(1).max(16 * 1024).nullable().optional(),
  aspectRatio: z.string().min(1).max(40),
  sourceFileName: z.string().max(512).nullable().optional(),
  isSizeManuallyAdjusted: z.boolean().optional(),
}).strict()

const trustedVideoUploadNodeDataSchema = nodeDataBaseSchema.extend({
  videoUrl: z.string().min(1).max(16 * 1024),
  previewImageUrl: z.string().min(1).max(16 * 1024).nullable().optional(),
  aspectRatio: z.string().min(1).max(40),
  durationSec: z.number().finite().nonnegative().nullable().optional(),
  sourceFileName: z.string().max(512).nullable().optional(),
  isSizeManuallyAdjusted: z.boolean().optional(),
}).strict()

const trustedAudioUploadNodeDataSchema = nodeDataBaseSchema.extend({
  audioUrl: z.string().min(1).max(16 * 1024),
  sourceFileName: z.string().max(512).nullable().optional(),
}).strict()

const imageGenerationNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()

interface CanvasNodeControlConfig {
  nodeType: CanvasNodeType
  title: string
  description: string
  aliases?: string[]
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

const nodeControlConfigs: CanvasNodeControlConfig[] = [
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
    aliases: ['图片生成节点', '生图节点'],
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
    aliases: ['文本提示词节点', '提示词节点', '字符串节点'],
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

const configByType = new Map(nodeControlConfigs.map((config) => [config.nodeType, config]))

export interface CanvasNodeControlCatalogEntry {
  nodeType: CanvasNodeType
  title: string
  description: string
  menuLabelKey: string
  media: CanvasNodeDefinition['media']
  supportsInput: boolean
  supportsOutput: boolean
  requiresModelSchema: boolean
  aliases: string[]
}

export interface CanvasNodeConnectionHandle {
  handleId: string
  purpose: 'source' | 'prompt' | 'model'
  valueType?: string
}

export interface CanvasNodeControlSchema {
  schemaVersion: typeof CANVAS_NODE_CONTROL_CATALOG_VERSION
  nodeType: CanvasNodeType
  title: string
  description: string
  menuLabelKey: string
  dataSchema: Record<string, unknown>
  defaultData: Record<string, unknown>
  connectivity: CanvasNodeDefinition['connectivity']
  ports: CanvasNodeDefinition['ports']
  connectionHandles: {
    source: CanvasNodeConnectionHandle | null
    targets: CanvasNodeConnectionHandle[]
  }
  requiresModelSchema: boolean
}

function toCatalogEntry(config: CanvasNodeControlConfig): CanvasNodeControlCatalogEntry {
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
    aliases: config.aliases ?? [],
  }
}

export function searchCanvasNodeTypes(query: string): CanvasNodeControlCatalogEntry[] {
  const normalized = query.trim().toLowerCase()
  const semanticQuery = normalized.replaceAll('节点', '')
  return nodeControlConfigs
    .filter((config) => {
      if (!normalized) return true
      const corpus = `${config.nodeType} ${config.title} ${config.description} ${(config.aliases ?? []).join(' ')}`
        .toLowerCase()
      return corpus.includes(normalized)
        || (semanticQuery.length > 0 && corpus.replaceAll('节点', '').includes(semanticQuery))
    })
    .map(toCatalogEntry)
}

export function getCanvasNodeSchema(nodeType: string): CanvasNodeControlSchema | null {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) return null
  const definition = getCanvasNodeDefinition(config.nodeType)
  if (!definition) return null
  return {
    schemaVersion: CANVAS_NODE_CONTROL_CATALOG_VERSION,
    nodeType: config.nodeType,
    title: config.title,
    description: config.description,
    menuLabelKey: definition.menuLabelKey,
    dataSchema: config.aiDataSchema,
    defaultData: definition.createDefaultData() as Record<string, unknown>,
    connectivity: definition.connectivity,
    ports: definition.ports,
    connectionHandles: {
      source: definition.connectivity.sourceHandle
        ? { handleId: 'source', purpose: 'source', valueType: definition.ports?.source?.emits }
        : null,
      targets: [
        ...(definition.generation
          ? [{ handleId: promptPortId(), purpose: 'prompt' as const, valueType: 'STRING' }]
          : []),
        ...(config.requiresModelSchema && definition.connectivity.targetHandleMode === 'rows'
          ? [{ handleId: modelPortId(), purpose: 'model' as const, valueType: 'MODEL' }]
          : []),
      ],
    },
    requiresModelSchema: config.requiresModelSchema,
  }
}

export function parseCanvasNodeData(
  nodeType: string,
  input: Record<string, unknown> | undefined
): { nodeType: CanvasNodeType; data: Partial<CanvasNodeData> } {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const data = config.dataSchema.parse(input ?? {})
  config.validateData?.(data)
  return { nodeType: config.nodeType, data: data as Partial<CanvasNodeData> }
}

/** 仅供已经从正式素材或生成结果解析出的媒体导入；不得接收模型或 IPC 原始输入。 */
export function parseTrustedMediaNodeData(
  nodeType: string,
  input: Record<string, unknown>,
): { nodeType: CanvasNodeType; data: Partial<CanvasNodeData> } {
  const schema = nodeType === CANVAS_NODE_TYPES.upload
    ? trustedImageUploadNodeDataSchema
    : nodeType === CANVAS_NODE_TYPES.videoUpload
      ? trustedVideoUploadNodeDataSchema
      : nodeType === CANVAS_NODE_TYPES.audioUpload
        ? trustedAudioUploadNodeDataSchema
        : null
  if (!schema) throw new Error(`媒体导入不支持节点类型：${nodeType}`)
  return {
    nodeType: nodeType as CanvasNodeType,
    data: schema.parse(input) as Partial<CanvasNodeData>,
  }
}

export function extractCanvasNodeData(
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

/** 这个节点类型的 data 到底接受哪些键；用于把"我丢掉了什么"说清楚。 */
export function listCanvasNodeDataKeys(nodeType: string): string[] {
  const config = configByType.get(nodeType as CanvasNodeType)
  return Object.keys((config?.aiDataSchema.properties ?? {}) as Record<string, unknown>)
}
