import { z } from 'zod'

import { registry } from '@/core/ModelRegistry'
import { validateParamValue } from '@/core/request'

import {
  CANVAS_NODE_TYPES,
  type CanvasNodeType,
} from './canvasNodes'

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
export const trustedImageUploadNodeDataSchema = nodeDataBaseSchema.extend({
  imageUrl: z.string().min(1).max(16 * 1024),
  previewImageUrl: z.string().min(1).max(16 * 1024).nullable().optional(),
  aspectRatio: z.string().min(1).max(40),
  sourceFileName: z.string().max(512).nullable().optional(),
  isSizeManuallyAdjusted: z.boolean().optional(),
}).strict()

export const trustedVideoUploadNodeDataSchema = nodeDataBaseSchema.extend({
  videoUrl: z.string().min(1).max(16 * 1024),
  previewImageUrl: z.string().min(1).max(16 * 1024).nullable().optional(),
  aspectRatio: z.string().min(1).max(40),
  durationSec: z.number().finite().nonnegative().nullable().optional(),
  sourceFileName: z.string().max(512).nullable().optional(),
  isSizeManuallyAdjusted: z.boolean().optional(),
}).strict()

export const trustedAudioUploadNodeDataSchema = nodeDataBaseSchema.extend({
  audioUrl: z.string().min(1).max(16 * 1024),
  sourceFileName: z.string().max(512).nullable().optional(),
}).strict()

const generationUiSchema = z.object({
  promptMode: z.enum(['required', 'optional', 'hidden']),
  modelMode: z.enum(['selectable', 'locked']),
  layoutMode: z.enum(['stacked', 'workbench']).optional(),
  excludeParamIds: z.array(z.string().min(1).max(120)).max(40),
  promptMaxCharacters: z.number().int().positive().max(32 * 1024).optional(),
}).strict()

const imageGenerationNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  generationUi: generationUiSchema.optional(),
}).strict()

const relightSpecialEditorDataSchema = z.object({
  relightSettings: z.record(z.string(), z.unknown()).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  prompt: z.string().max(32 * 1024).optional(),
  promptDocument: z.unknown().optional(),
  promptTemplateVersion: z.string().min(1).max(200).optional(),
  lightingReferenceImages: z.array(z.string().min(1).max(16 * 1024)).max(1).optional(),
  relightRouteReasons: z.array(z.string().max(500)).optional(),
}).strict()

const multiAngleSpecialEditorDataSchema = z.object({
  multiAngleConfig: z.record(z.string(), z.unknown()).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  prompt: z.literal('').optional(),
}).strict()

const elementEditSpecialEditorDataSchema = z.object({
  localRedrawMaskSource: z.string().min(1).max(16 * 1024).nullable().optional(),
  localRedrawMaskDocument: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict()

export interface CanvasNodeControlConfig {
  nodeType: CanvasNodeType
  title: string
  description: string
  aliases?: string[]
  dataSchema: z.ZodType<Record<string, unknown>>
  specialEditorDataSchema?: z.ZodType<Record<string, unknown>>
  aiDataSchema: Record<string, unknown>
  requiresModelSchema: boolean
  hasPromptHandle?: boolean
  /** 复制节点时必须保留、但绝不能开放给通用助手写入的受控字段。 */
  trustedCopyDataKeys?: readonly string[]
  validateData?: (
    data: Record<string, unknown>,
    context: CanvasNodeDataValidationContext,
  ) => void
}
interface CanvasNodeDataValidationContext {
  allowHiddenModels: boolean
}
export const PUBLIC_NODE_DATA_VALIDATION: CanvasNodeDataValidationContext = {
  allowHiddenModels: false,
}
export const CONTROLLED_NODE_DATA_VALIDATION: CanvasNodeDataValidationContext = {
  allowHiddenModels: true,
}
function validateImageGenerationData(
  data: Record<string, unknown>,
  context: CanvasNodeDataValidationContext,
): void {
  validateGenerationData(data, 'image', context)
}
function validateGenerationData(
  data: Record<string, unknown>,
  expectedMediaType: 'image' | 'video' | 'audio',
  context: CanvasNodeDataValidationContext,
): void {
  if (typeof data.modelId !== 'string') return
  const model = context.allowHiddenModels
    ? registry.getModel(data.modelId)
    : registry.getDiscoverableModel(data.modelId)
  if (!model && registry.hasModel(data.modelId) && !context.allowHiddenModels) {
    throw new Error('受控执行模型不能通过通用画布节点使用，请改用对应的画布图片能力')
  }
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
  expectedMediaType: 'image' | 'video' | 'audio',
  context: CanvasNodeDataValidationContext,
): void {
  if (typeof data.modelId !== 'string') return
  const model = context.allowHiddenModels
    ? registry.getModel(data.modelId)
    : registry.getDiscoverableModel(data.modelId)
  if (!model && registry.hasModel(data.modelId) && !context.allowHiddenModels) {
    throw new Error('受控执行模型不能通过通用模型选择器使用，请改用对应的画布图片能力')
  }
  if (!model || model.meta.type !== expectedMediaType) {
    throw new Error(`模型选择器只能输出已注册的${expectedMediaType}模型`)
  }
}
const textAnnotationNodeDataSchema = nodeDataBaseSchema.extend({
  content: z.string().max(32 * 1024).optional(),
}).strict()
const textProcessingNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  systemPrompt: z.string().max(32 * 1024).optional(),
  systemPromptTemplateId: z.string().min(1).max(200).optional(),
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(500).optional(),
  fixedResult: z.boolean().optional(),
}).strict()
const generationNodeDataSchema = nodeDataBaseSchema.extend({
  prompt: z.string().max(32 * 1024).optional(),
  modelId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()
const storyboardGenerationNodeDataSchema = generationNodeDataSchema.extend({
  capabilityId: z.literal('image.nine-grid').optional(),
  storyboardPreset: z.literal('nine-grid-v1').optional(),
  promptTemplateVersion: z.literal('nine-grid-storyboard-v1').optional(),
  gridRows: z.number().int().min(1).max(9).optional(),
  gridCols: z.number().int().min(1).max(9).optional(),
  frames: z.array(z.object({
    id: z.string().min(1).max(200),
    description: z.string().max(32 * 1024),
    descriptionDocument: z.unknown().optional(),
    referenceIndex: z.number().int().nonnegative().nullable(),
  }).strict()).max(81).optional(),
}).strict()
const numberSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.number().finite().optional() }).strict()
const stringSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.string().max(32 * 1024).optional() }).strict()
const booleanSourceNodeDataSchema = nodeDataBaseSchema.extend({ value: z.boolean().optional() }).strict()
const modelSelectorNodeDataSchema = nodeDataBaseSchema.extend({ modelId: z.string().min(1).optional() }).strict()
export const nodeControlConfigs: CanvasNodeControlConfig[] = [
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
    title: '图片生成节点',
    description: '创建配置驱动的图片生成节点；modelId 和 params 必须来自模型目录与模型 schema。',
    aliases: ['AI 图片', 'AI 图片生成节点', '生图节点'],
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
    trustedCopyDataKeys: ['generationUi'],
    validateData: validateImageGenerationData,
  },
  {
    nodeType: CANVAS_NODE_TYPES.panoramaGen,
    title: '720°全景生成节点',
    description: '创建固定为完整等距柱状投影、2:1、单张输出的全景生成节点。',
    aliases: ['全景节点', '全景生成节点', '720度全景节点'],
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
    nodeType: CANVAS_NODE_TYPES.relightGen,
    title: '图片打光节点',
    description: '创建使用受控打光编辑器的图片重打光节点；模式、模型和提示词由打光契约维护。',
    aliases: ['打光节点', '图片重打光节点'],
    dataSchema: imageGenerationNodeDataSchema,
    specialEditorDataSchema: relightSpecialEditorDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.multiAngleGen,
    title: '多角度视图节点',
    description: '创建受控多角度批次节点；角度 profile、模型与输出顺序由版本化契约维护。',
    aliases: ['多视图节点', '相机角度节点', '环绕视图节点'],
    dataSchema: imageGenerationNodeDataSchema,
    specialEditorDataSchema: multiAngleSpecialEditorDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.upscaleGen,
    title: '高清放大节点',
    description: '创建受控 Topaz 忠实放大节点；倍率、处理模式与人脸增强由节点参数维护。',
    aliases: ['超分节点', '图片放大节点', '高清节点'],
    dataSchema: imageGenerationNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.portraitTextureGen,
    title: '人像质感节点',
    description: '创建受控的保守人像质感编辑节点；预设、强度与身份保护约束由版本化契约维护。',
    aliases: ['人像修图节点', '人像质感调节节点'],
    dataSchema: imageGenerationNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.elementEditGen,
    title: '局部重绘节点',
    description: '创建先裁剪蒙版区域、调用任意图片编辑模型、配准后回贴原图的局部重绘节点。',
    aliases: ['元素编辑节点', '局部编辑节点', '蒙版编辑节点', '图片擦除节点'],
    dataSchema: imageGenerationNodeDataSchema,
    specialEditorDataSchema: elementEditSpecialEditorDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.layerSeparationGen,
    title: '图层拆分节点',
    description: '创建受控 Seedream 图层拆分节点；结构化图层输出由版本化契约维护。',
    aliases: ['图层分离节点', '图片拆层节点'],
    dataSchema: imageGenerationNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 120 },
        prompt: { type: 'string', maxLength: 32 * 1024 },
      },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.layerStackResult,
    title: '多图层图片文档节点',
    description: '打开完整图片编辑器持续编辑多图层图片文档，并以最新合成图连接其他节点。',
    aliases: ['多图层图片', '分层图片文档', '图层结果节点'],
    dataSchema: nodeDataBaseSchema.strict(),
    aiDataSchema: {
      type: 'object',
      properties: { displayName: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
    requiresModelSchema: false,
  },
  {
    nodeType: CANVAS_NODE_TYPES.videoGen,
    title: '视频生成节点',
    description: '创建配置驱动的视频生成节点；模型与参数必须来自目录和 schema。',
    aliases: ['AI 视频', 'AI 视频生成节点', '生视频节点'],
    dataSchema: generationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, prompt: { type: 'string', maxLength: 32768 }, modelId: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data, context) => validateGenerationData(data, 'video', context),
  },
  {
    nodeType: CANVAS_NODE_TYPES.audioGen,
    title: '音频生成节点',
    description: '创建配置驱动的音频生成节点；模型与参数必须来自目录和 schema。',
    aliases: ['AI 音频', 'AI 音频生成节点', '生音频节点'],
    dataSchema: generationNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, prompt: { type: 'string', maxLength: 32768 }, modelId: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data, context) => validateGenerationData(data, 'audio', context),
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
    nodeType: CANVAS_NODE_TYPES.textProcessing,
    title: '文本处理节点',
    description: '使用已配置的大语言模型处理提示词，可按模型能力接收图片、视频或音频。',
    aliases: ['大语言模型节点', 'LLM 节点', '文本生成节点'],
    dataSchema: textProcessingNodeDataSchema,
    aiDataSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 120 },
        prompt: { type: 'string', maxLength: 32768 },
        systemPrompt: { type: 'string', maxLength: 32768 },
        systemPromptTemplateId: { type: 'string', maxLength: 200 },
        providerId: { type: 'string', maxLength: 200 },
        modelId: { type: 'string', maxLength: 500 },
        fixedResult: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    requiresModelSchema: false,
    hasPromptHandle: true,
  },
  {
    nodeType: CANVAS_NODE_TYPES.textAnnotation,
    title: '文本展示节点',
    description: '创建可编辑、可连接下游的文本展示节点。',
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
    validateData: (data, context) => validateModelSelectorData(data, 'image', context),
  },
  {
    nodeType: CANVAS_NODE_TYPES.videoModelSelector,
    title: '视频模型选择器',
    description: '向兼容模型端口输出视频模型标识。',
    dataSchema: modelSelectorNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data, context) => validateModelSelectorData(data, 'video', context),
  },
  {
    nodeType: CANVAS_NODE_TYPES.audioModelSelector,
    title: '音频模型选择器',
    description: '向兼容模型端口输出音频模型标识。',
    dataSchema: modelSelectorNodeDataSchema,
    aiDataSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, modelId: { type: 'string' } }, additionalProperties: false },
    requiresModelSchema: true,
    validateData: (data, context) => validateModelSelectorData(data, 'audio', context),
  },
]
