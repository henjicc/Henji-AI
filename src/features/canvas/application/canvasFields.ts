import { readStoryboardFrameNote } from './storyboardPromptDocument';
import { z } from 'zod'
import { listCanvasNodeContinuations } from './canvasGenerationContinuationService'

import {
  fieldWriterTable,
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { CanvasNode } from '@/stores/canvasStore'

import { isAssetGroupNode, isStoryboardSplitNode, isTextAnnotationNode } from '../domain/canvasNodes'
import { listCanvasNodeDataKeys } from '../domain/nodeControlRegistry'
import { nodeControlConfigs } from '../domain/nodeControlRegistryDefinitions'
import type { CanvasNodePropertyPatch, CanvasStoryboardFramePatch } from './canvasMutationService'
import {
  canvasNodeGenerationConfigSchema, readCanvasNodeGenerationConfig, readCanvasNodeGenerationSchema,
} from './canvasNodeGenerationConfig'

/*
 * 画布与节点的可写属性统一定义——1.3 迁移（project.name 1 + node.display_name/position 2），
 * 3.2 又加了 node.storyboard_frames 1 条。不单独抽公共 shared 模块（像三维那样）：画布这边
 * 字段不多，样板重复换不来收益。
 */

const PROJECT_ENTITY_TYPE = 'canvas.document' as const
const NODE_ENTITY_TYPE = 'canvas.node' as const
const REVISION_SCOPE = 'canvas' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function canvasDescriptor(
  entityType: string,
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  description?: string,
  nullable = false,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: description ?? `画布${title}的稳定控制属性。`,
    value,
    nullable,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['canvas:read'], write: ['canvas:write'] },
    revisionScopes: [REVISION_SCOPE],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
  }
}

/** 写入目标只有画布 id——改名直接落到领域服务，没有需要累积的中间态。 */
/**
 * 画布名就是 `.hjcvs` 的文件名（3.4）：只读，改名走通用文档属性 documents.document.name（同一个 ID）。
 */
export const PROJECT_FIELDS: ApplicationFieldDefinition<{ name: string }, string>[] = [
  {
    propertyId: `${PROJECT_ENTITY_TYPE}.name`,
    descriptor: {
      ...canvasDescriptor(PROJECT_ENTITY_TYPE, 'name', '画布名称', { kind: 'string', minLength: 1, maxLength: 200 }),
      requiredPermissions: { read: ['canvas:read'], write: [] },
      readOnlyReason: '画布名就是画布文档的文件名：改名用 change_application_entities 写 documents.document.name（同一个 id）。',
    },
    read: (project) => project.name,
    storeActions: [],
  },
]

function vector2(value: JsonValue | undefined): { x: number; y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT')
  const x = value.x
  const y = value.y
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new Error('INVALID_INPUT')
  }
  return { x, y }
}

const STORYBOARD_FRAMES_VALUE: ApplicationPropertyValue = {
  kind: 'json',
  schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id: `${NODE_ENTITY_TYPE}.storyboard_frames.value`,
    version: 1,
    digest: digest(`property:${NODE_ENTITY_TYPE}.storyboard_frames.value`),
  },
}

const ASSET_GROUP_MEMBER_ORDER_VALUE: ApplicationPropertyValue = {
  kind: 'json',
  schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id: `${NODE_ENTITY_TYPE}.asset_group_member_order.value`,
    version: 1,
    digest: digest(`property:${NODE_ENTITY_TYPE}.asset_group_member_order.value`),
  },
}

const storyboardFramePatchSchema = z.object({
  id: z.string().min(1),
  note: z.string().max(4_000).optional(),
  order: z.number().int().min(0).optional(),
}).strict()

const assetGroupMemberOrderSchema = z.array(z.string().min(1)).max(200)
const storyboardFramePatchesSchema = z.array(storyboardFramePatchSchema).min(1).max(200)

function generationJsonValue(suffix: string): Extract<ApplicationPropertyValue, { kind: 'json' }> {
  const id = `${NODE_ENTITY_TYPE}.${suffix}.value`
  return { kind: 'json', schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind: 'property', id,
    version: 1, digest: digest(`property:${id}`),
  } }
}

const GENERATION_CONFIG_VALUE = generationJsonValue('generation_config')
const GENERATION_SCHEMA_VALUE = generationJsonValue('generation_schema')
const GENERATION_CONTINUATIONS_VALUE = generationJsonValue('generation_continuations')
const generationContinuationsSchema = z.array(z.object({ id: z.string(), targetModelId: z.string(), submit: z.enum(['direct', 'edit']) }))
/*
 * 节点 data 里面向助手公开的每个键各成一条可写属性（数值/文字/开关节点的 value、文本处理的 system_prompt、
 * 分镜生成的 grid_rows 等）。属性表从节点目录的公开数据结构派生：给某类节点新增一个公开键，它就自动可读可写，
 * 不需要回到这里登记——逐条手写时界面能改而助手改不了的键一直在漏。
 */
/** 已有专属属性承接的键：标题、文本正文、生成参数（随 generation_config 整体写）。 */
const DATA_KEYS_WITH_OWN_PROPERTY = new Set(['displayName', 'content', 'params'])
const DATA_KEY_TITLES: Record<string, string> = {
  value: '节点的值', prompt: '提示词', modelId: '模型', providerId: '模型供应商', systemPrompt: '系统提示词',
  systemPromptTemplateId: '系统提示词模板', fixedResult: '固定结果', gridRows: '分镜行数', gridCols: '分镜列数', frames: '分镜每格描述',
}
const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

const NODE_DATA_KEYS = (() => {
  const byKey = new Map<string, { nodeTypes: string[]; schemas: JsonValue[] }>()
  for (const config of nodeControlConfigs) {
    for (const [key, schema] of Object.entries((config.aiDataSchema.properties ?? {}) as Record<string, JsonValue>)) {
      // 固定取值的键（能力标识、模板版本）没有可改的余地
      if (DATA_KEYS_WITH_OWN_PROPERTY.has(key) || (schema && typeof schema === 'object' && !Array.isArray(schema) && 'const' in schema)) continue
      const entry = byKey.get(key) ?? { nodeTypes: [], schemas: [] }
      entry.nodeTypes.push(config.nodeType)
      if (!entry.schemas.some((item) => JSON.stringify(item) === JSON.stringify(schema))) entry.schemas.push(schema)
      byKey.set(key, entry)
    }
  }
  return [...byKey].map(([key, entry]) => ({ key, ...entry, value: generationJsonValue(`${snakeCase(key)}`) }))
})()

/** 节点数据属性与它对应的 data 键，供按节点类型判断这一项是否存在。 */
export const CANVAS_NODE_DATA_PROPERTIES = NODE_DATA_KEYS.map(({ key }) => ({ propertyId: `${NODE_ENTITY_TYPE}.${snakeCase(key)}`, dataKey: key }))

export const CANVAS_NODE_SCHEMA_DOCUMENTS = [
  ...NODE_DATA_KEYS.map(({ value, schemas }) => ({ ref: value.schemaRef, value: (schemas.length === 1 ? schemas[0] : { anyOf: schemas }) as JsonValue })),
  { ref: STORYBOARD_FRAMES_VALUE.schemaRef, value: z.toJSONSchema(storyboardFramePatchesSchema) as JsonValue },
  { ref: ASSET_GROUP_MEMBER_ORDER_VALUE.schemaRef, value: z.toJSONSchema(assetGroupMemberOrderSchema) as JsonValue },
  { ref: GENERATION_CONFIG_VALUE.schemaRef, value: z.toJSONSchema(canvasNodeGenerationConfigSchema) as JsonValue },
  { ref: GENERATION_SCHEMA_VALUE.schemaRef, value: z.toJSONSchema(z.record(z.string(), z.unknown()).nullable()) as JsonValue },
  { ref: GENERATION_CONTINUATIONS_VALUE.schemaRef, value: z.toJSONSchema(generationContinuationsSchema) as JsonValue },
]

function parseStoryboardFramePatches(raw: JsonValue | undefined): CanvasStoryboardFramePatch[] {
  return storyboardFramePatchesSchema.parse(raw)
}

/** 写入目标是节点补丁本身——两条属性合成一个 patch 再整体提交，逐条提交会产生两次历史记录。 */
export const NODE_FIELDS: ApplicationFieldDefinition<
  CanvasNode, CanvasNodePropertyPatch, 'updateNodeData' | 'updateNodePosition' | 'updateStoryboardFrame' | 'reorderStoryboardFrame'
>[] = [
  {
    propertyId: `${NODE_ENTITY_TYPE}.text_content`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'text_content', '文本正文',
      { kind: 'string', maxLength: 32768 },
      '文本节点的可编辑正文，可保存剧本、角色设定或镜头说明。仅按需读取目标节点，不必读取整个画布；非文本节点返回 null。空字符串清空正文。', true),
    read: (node) => isTextAnnotationNode(node) ? node.data.content ?? '' : null,
    writer: { write(patch, mutation) {
      patch.textContent = z.string().max(32768).parse(mutation.value)
    } },
    storeActions: ['updateNodeData'],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.generation_config`,
    // 参数会按节点与模型约束补默认值、去掉不认识的键，读回与写入值不完全相同。
    descriptor: { ...canvasDescriptor(NODE_ENTITY_TYPE, 'generation_config', '生成配置',
      GENERATION_CONFIG_VALUE,
      '仅生成节点支持。整体写入 {prompt: 字符串, modelId: 非空模型 ID, params: 参数对象}，三个字段均必填。'
      + '先读取 generation_schema 获取当前模型参数及锁定约束；引用素材通过画布连线提供。修改配置不会提交付费生成。', true), valueComparison: 'normalized' },
    read: readCanvasNodeGenerationConfig,
    writer: { write(patch, mutation) {
      patch.generationConfig = canvasNodeGenerationConfigSchema.parse(mutation.value)
    } },
    storeActions: ['updateNodeData'],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.generation_schema`,
    descriptor: {
      ...canvasDescriptor(NODE_ENTITY_TYPE, 'generation_schema', '生成配置说明',
        GENERATION_SCHEMA_VALUE, '当前节点的生成模型参数、配置字段和模型锁定约束；非生成节点返回 null。', true),
      requiredPermissions: { read: ['canvas:read'], write: [] },
      readOnlyReason: '由节点类型与当前模型目录共同确定。',
    },
    read: readCanvasNodeGenerationSchema,
    storeActions: [],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.generation_continuations`,
    descriptor: {
      ...canvasDescriptor(NODE_ENTITY_TYPE, 'generation_continuations', '可做的续接',
        GENERATION_CONTINUATIONS_VALUE,
        '生成结果节点能接着做的续接（finalize-draft 草稿转正片、extend 续写、animate 做成视频）；'
        + '要续接时用 create_visible_generation_task 传 continueFrom={kind:"canvas.node",documentId,nodeId,continuationId}，modelId 用 targetModelId。非生成结果返回空数组。', true),
      requiredPermissions: { read: ['canvas:read'], write: [] },
      readOnlyReason: '由生成结果在完成时记下，随结果节点保存；续接通过生成能力提交，不直接改写。',
    },
    read: (node) => listCanvasNodeContinuations(node).map(({ id, targetModelId, submit }) => ({ id, targetModelId, submit })),
    storeActions: [],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.display_name`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'display_name', '节点标题', { kind: 'string', minLength: 1, maxLength: 120 }),
    read: (node) => node.data.displayName ?? node.type,
    writer: {
      write(patch, mutation) {
        if (typeof mutation.value !== 'string' || !mutation.value.trim()) throw new Error('INVALID_INPUT')
        patch.displayName = mutation.value
      },
    },
    storeActions: ['updateNodeData'],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.position`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'position', '节点位置', { kind: 'vector2', unit: 'canvas_pixel' }),
    read: (node) => ({ x: node.position.x, y: node.position.y }),
    writer: {
      write(patch, mutation) {
        if (mutation.value === undefined) throw new Error('INVALID_INPUT')
        patch.position = vector2(mutation.value)
      },
    },
    storeActions: ['updateNodePosition'],
  },
  /*
   * 只对 storyboardSplit 类型节点有意义（3.2）：读取对其他节点类型返回空数组，而不是省略这条
   * 属性——canvas.node 是所有节点类型共享的同一份属性描述符列表，没有按实例类型过滤声明的机制
   * （不像三维 animatable.* 那样已经建了这一层）。写入按 id 定点更新 note/order；order 直接写入
   * 即完成排序（reorderStoryboardFrame 内部也是把移动后每张卡的 order 重新赋值为数组下标，
   * 直接写 order 是同一件事）。
   */
  {
    propertyId: `${NODE_ENTITY_TYPE}.storyboard_frames`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'storyboard_frames', '分镜格子', STORYBOARD_FRAMES_VALUE,
      '只对分镜格子节点（storyboardSplit）有意义，其他节点类型读到空数组。数组元素 {id, note, order}：'
      + 'note 是格子说明文字，order 决定排列顺序（越小越靠前）。写入按 id 定点更新，只需要传要改的字段；'
      + 'id 必须取自读取结果里的原值，不支持增删格子。'),
    read: (node) => (isStoryboardSplitNode(node)
      ? node.data.frames.map((frame) => ({ id: frame.id, note: readStoryboardFrameNote(frame), order: frame.order }))
      : []) as JsonValue,
    writer: {
      write(patch, mutation) {
        patch.storyboardFrames = parseStoryboardFramePatches(mutation.value)
      },
    },
    storeActions: ['updateStoryboardFrame', 'reorderStoryboardFrame'],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.asset_group_member_order`,
    descriptor: canvasDescriptor(
      NODE_ENTITY_TYPE,
      'asset_group_member_order',
      '素材组成员顺序',
      ASSET_GROUP_MEMBER_ORDER_VALUE,
      '只对素材组节点有意义。值为成员节点 ID 数组；排序同时决定容量不足时的自动连接优先级。',
    ),
    read: (node) => (isAssetGroupNode(node) ? node.data.memberOrder : []) as JsonValue,
    writer: {
      write(patch, mutation) {
        patch.assetGroupMemberOrder = assetGroupMemberOrderSchema.parse(mutation.value)
      },
    },
    storeActions: [],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.asset_group_cover_member_id`,
    descriptor: canvasDescriptor(
      NODE_ENTITY_TYPE,
      'asset_group_cover_member_id',
      '素材组封面成员',
      { kind: 'string', minLength: 1, maxLength: 160 },
      '只对素材组节点有意义。写入组内成员节点 ID；null 表示保持当前自动封面。',
      true,
    ),
    read: (node) => (isAssetGroupNode(node) ? node.data.coverMemberId : null),
    writer: {
      write(patch, mutation) {
        if (mutation.value !== null && typeof mutation.value !== 'string') throw new Error('INVALID_INPUT')
        patch.assetGroupCoverMemberId = mutation.value
      },
    },
    storeActions: [],
  },
  ...NODE_DATA_KEYS.map(({ key, nodeTypes, value }): ApplicationFieldDefinition<CanvasNode, CanvasNodePropertyPatch, 'updateNodeData'> => ({
    propertyId: `${NODE_ENTITY_TYPE}.${snakeCase(key)}`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, snakeCase(key), DATA_KEY_TITLES[key] ?? key, value,
      `只对这些节点类型有意义：${nodeTypes.join('、')}；其他类型读到 null，写入被拒绝。`
      + (key === 'prompt' || key === 'modelId' ? '生成节点要同时改提示词、模型与参数时写 generation_config，同一次修改里两者不能并存。' : ''), true),
    read: (node) => listCanvasNodeDataKeys(node.type).includes(key)
      ? JSON.parse(JSON.stringify((node.data as Record<string, unknown>)[key] ?? null)) as JsonValue : null,
    writer: { write(patch, mutation) {
      if (mutation.value === null || mutation.value === undefined) throw new Error(`INVALID_INPUT:${snakeCase(key)} 不能写成空值。`)
      patch.data = { ...patch.data, [key]: mutation.value }
    } },
    storeActions: ['updateNodeData'],
  })),
]

export const CANVAS_NODE_WRITERS = fieldWriterTable(NODE_FIELDS)
