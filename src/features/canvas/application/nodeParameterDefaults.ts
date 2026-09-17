import { registry } from '@/core/ModelRegistry'
import { createLogger } from '@/core/logging'
import type { ParamDef } from '@/core/types'
import { extractDefaults } from '@/hooks/utils/defaultExtractor'
import { applyModelAliasParamDefaults, normalizeModelAliasParams } from '@/core/params/modelAliasDefaults'
import type { CanvasNodeData } from '../domain/canvasNodes'
import type { CanvasNodeDefinition } from '../domain/nodeRegistryContracts'

export const NODE_PARAMETER_DEFAULTS_KEY = 'henji-canvas-node-parameter-defaults-v1'
const logger = createLogger('canvas.node_parameter_defaults')
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

// 参数控件白名单：自由文本、上传和未声明结构的自定义面板不进入偏好设置。
export function selectDefaultModelParams(schema: ParamDef[], values: DynamicValueMap): DynamicValueMap {
  const result: DynamicValueMap = {}
  for (const param of schema) {
    if (param.type === 'panel') {
      Object.assign(result, selectDefaultModelParams(param.children, values))
      continue
    }
    if (param.type === 'composite') {
      if (param.panel === 'voice-selector' && typeof values[param.id] === 'string') {
        result[param.id] = values[param.id]
      } else if (param.config && 'components' in param.config && Array.isArray(param.config.components)) {
        const current = record(values[param.id])
        const selected: DynamicValueMap = {}
        for (const component of param.config.components) {
          if (['text-input', 'file-input'].includes(component.type)) continue
          if (current[component.id] !== undefined) selected[component.id] = structuredClone(current[component.id]) as DynamicValue
        }
        result[param.id] = selected
      } else if (param.panel === 'resolution') {
        const current = record(values[param.id])
        result[param.id] = Object.fromEntries(Object.entries(current).filter(([key, value]) => (
          ['width', 'height', 'aspectRatio', 'quality', 'qualityTier', 'resolution', 'mode'].includes(key)
          && ['string', 'number'].includes(typeof value)
        ))) as DynamicValueMap
      }
      continue
    }
    if (!['number', 'dropdown', 'radio', 'switch', 'resolution', 'aspect-ratio'].includes(param.type)) continue
    const value = values[param.id]
    if (value !== undefined) result[param.id] = structuredClone(value)
  }
  return result
}

export function supportsNodeParameterDefaults(definition: CanvasNodeDefinition): boolean {
  return Boolean(definition.generation || definition.defaultParameterFields?.length)
}

export function collectNodeParameterDefaults(
  definition: CanvasNodeDefinition,
  data: Partial<CanvasNodeData>,
): Partial<CanvasNodeData> {
  const source = { ...definition.createDefaultData(), ...data } as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const path of definition.defaultParameterFields ?? []) {
    const keys = path.split('.')
    let value: unknown = source
    for (const key of keys) value = record(value)[key]
    if (value === undefined) continue
    let target = result
    for (const key of keys.slice(0, -1)) {
      target[key] ??= {}
      target = record(target[key])
    }
    target[keys[keys.length - 1]] = structuredClone(value)
  }
  if (definition.generation && typeof source.modelId === 'string') {
    const model = registry.getModel(source.modelId)
    if (model) {
      const schema = registry.getSchema(source.modelId)
      result.modelId = source.modelId
      result.params = selectDefaultModelParams(schema, {
        ...applyModelAliasParamDefaults(source.modelId, model, schema, extractDefaults(schema)),
        ...normalizeModelAliasParams(model, record(source.params) as DynamicValueMap),
      })
    }
  }
  return result as Partial<CanvasNodeData>
}

export class NodeParameterDefaults {
  constructor(private readonly storage: () => Storage = () => window.localStorage) {}

  save(definition: CanvasNodeDefinition, data: CanvasNodeData): void {
    if (!supportsNodeParameterDefaults(definition)) throw new Error('此节点没有可保存的参数')
    logger.info('保存节点默认参数', { event: 'canvas.node_defaults.save.start', nodeType: definition.type })
    try {
      const defaults = collectNodeParameterDefaults(definition, data)
      const all = this.load()
      this.storage().setItem(NODE_PARAMETER_DEFAULTS_KEY, JSON.stringify({ ...all, [definition.type]: defaults }))
      logger.info('节点默认参数已保存', { event: 'canvas.node_defaults.save.completed', nodeType: definition.type })
    } catch (error) {
      logger.error('保存节点默认参数失败', error, { event: 'canvas.node_defaults.save.failed', nodeType: definition.type })
      throw error
    }
  }

  resolve(definition: CanvasNodeDefinition, explicit: Partial<CanvasNodeData>): Partial<CanvasNodeData> {
    if (!supportsNodeParameterDefaults(definition)) return {}
    const saved = record(this.load()[definition.type])
    if (!Object.keys(saved).length) return {}
    // 显式创建另一模型时不可套用之前模型的参数；复制/导入显式值始终优先。
    if (explicit.modelId !== undefined && explicit.modelId !== saved.modelId) return {}
    const filtered = collectNodeParameterDefaults(definition, saved as Partial<CanvasNodeData>)
    return mergeDefaultObjects(definition.createDefaultData(), filtered) as Partial<CanvasNodeData>
  }

  private load(): Record<string, unknown> {
    try {
      const value = this.storage().getItem(NODE_PARAMETER_DEFAULTS_KEY)
      return value ? record(JSON.parse(value)) : {}
    } catch (error) {
      logger.warn('节点默认参数读取失败，使用初始参数', { event: 'canvas.node_defaults.load.failed', error: String(error) })
      return {}
    }
  }
}

function mergeDefaultObjects(base: unknown, patch: unknown): Record<string, unknown> {
  const result = { ...record(base) }
  for (const [key, value] of Object.entries(record(patch))) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeDefaultObjects(result[key], value) : structuredClone(value)
  }
  return result
}

export const nodeParameterDefaults = new NodeParameterDefaults()
