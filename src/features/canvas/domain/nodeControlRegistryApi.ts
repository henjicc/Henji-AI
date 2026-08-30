import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
} from './canvasNodes'
import {
  CONTROLLED_NODE_DATA_VALIDATION,
  CANVAS_NODE_CONTROL_CATALOG_VERSION,
  PUBLIC_NODE_DATA_VALIDATION,
  nodeControlConfigs,
  trustedAudioUploadNodeDataSchema,
  trustedImageUploadNodeDataSchema,
  trustedVideoUploadNodeDataSchema,
  type CanvasNodeControlConfig,
} from './nodeControlRegistryDefinitions'
import {
  getCanvasNodeDefinition,
  type CanvasNodeDefinition,
} from './nodeRegistry'
import { modelPortId, promptPortId } from './socketTypes'

export { CANVAS_NODE_CONTROL_CATALOG_VERSION }

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
        ...(definition.generation || config.hasPromptHandle
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
  const raw = input ?? {}
  const publicKeys = new Set(
    Object.keys((config.aiDataSchema.properties ?? {}) as Record<string, unknown>),
  )
  const controlledKeys = Object.keys(raw).filter((key) => !publicKeys.has(key))
  if (controlledKeys.length > 0) {
    throw new Error(
      `通用画布节点不能写入受控字段：${controlledKeys.join('、')}。`
      + '请使用对应的画布图片能力创建或配置专用节点。',
    )
  }
  const data = config.dataSchema.parse(raw)
  config.validateData?.(data, PUBLIC_NODE_DATA_VALIDATION)
  return { nodeType: config.nodeType, data: data as Partial<CanvasNodeData> }
}

/** 图片能力内部创建固定模型/固定编辑器节点的窄通道，不对助手公共 schema 开放。 */
export function parseCanvasControlledNodeData(
  nodeType: string,
  input: Record<string, unknown> | undefined,
): { nodeType: CanvasNodeType; data: Partial<CanvasNodeData> } {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const data = config.dataSchema.parse(input ?? {})
  config.validateData?.(data, CONTROLLED_NODE_DATA_VALIDATION)
  return { nodeType: config.nodeType, data: data as Partial<CanvasNodeData> }
}

/** 专用编辑器的内部写入白名单，与助手可写 data schema 严格分离。 */
export function parseCanvasSpecialEditorData(
  nodeType: string,
  input: Record<string, unknown>,
): Partial<CanvasNodeData> {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const schema = config.specialEditorDataSchema ?? config.dataSchema
  const data = schema.parse(input)
  config.validateData?.(data, CONTROLLED_NODE_DATA_VALIDATION)
  return data as Partial<CanvasNodeData>
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
  data: Record<string, unknown>,
  validationBase: Record<string, unknown> = {},
  allowHiddenModels = false,
): Partial<CanvasNodeData> {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const properties = (config.aiDataSchema.properties ?? {}) as Record<string, unknown>
  const supported = Object.fromEntries(Object.entries(data).filter(([key]) => key in properties))
  const parsed = config.dataSchema.parse(supported)
  config.validateData?.(
    { ...validationBase, ...parsed },
    allowHiddenModels ? CONTROLLED_NODE_DATA_VALIDATION : PUBLIC_NODE_DATA_VALIDATION,
  )
  return parsed as Partial<CanvasNodeData>
}

/**
 * 复制必须保留固定工具的锁定 UI 契约，但不能因此把 generationUi 开放给通用更新。
 * 这里只复制每类节点显式声明的可信键，并允许精确解析受控执行模型。
 */
export function extractCanvasNodeDataForDuplication(
  nodeType: string,
  data: Record<string, unknown>,
): Partial<CanvasNodeData> {
  const config = configByType.get(nodeType as CanvasNodeType)
  if (!config) throw new Error(`当前闭环不支持节点类型：${nodeType}`)
  const publicProperties = (config.aiDataSchema.properties ?? {}) as Record<string, unknown>
  const allowed = new Set([
    ...Object.keys(publicProperties),
    ...(config.trustedCopyDataKeys ?? []),
  ])
  const supported = Object.fromEntries(
    Object.entries(data).filter(([key]) => allowed.has(key)),
  )
  const parsed = config.dataSchema.parse(supported)
  config.validateData?.(parsed, CONTROLLED_NODE_DATA_VALIDATION)
  return parsed as Partial<CanvasNodeData>
}

/** 这个节点类型的 data 到底接受哪些键；用于把"我丢掉了什么"说清楚。 */
export function listCanvasNodeDataKeys(nodeType: string): string[] {
  const config = configByType.get(nodeType as CanvasNodeType)
  return Object.keys((config?.aiDataSchema.properties ?? {}) as Record<string, unknown>)
}
