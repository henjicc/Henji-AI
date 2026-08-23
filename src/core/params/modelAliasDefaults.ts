import type { ModelDefinition, ParamDef } from '@/core/types'

/**
 * 把已删除模型入口保存的旧参数 ID 映射到当前 schema。
 * 遍历全部入口映射是有意的：生成页可能先把旧 modelId 规范化为当前 ID，
 * 随后才恢复历史参数，此时仍必须识别旧参数名。
 */
export function normalizeModelAliasParams(
  model: ModelDefinition | undefined,
  params: DynamicValueMap
): DynamicValueMap {
  const mappings = model?.meta.aliasParamMappings
  if (!mappings) return params

  const next = { ...params }
  for (const mapping of Object.values(mappings)) {
    for (const [legacyParamId, currentParamId] of Object.entries(mapping)) {
      if (next[currentParamId] === undefined && next[legacyParamId] !== undefined) {
        next[currentParamId] = next[legacyParamId]
      }
    }
  }
  return next
}

/**
 * 把旧模型别名对应的模式默认值合并进一次请求。
 * 显式参数始终优先，避免覆盖历史项目已经保存的新值。
 */
export function mergeModelAliasParamDefaults(
  requestedModelId: string,
  model: ModelDefinition | undefined,
  params: DynamicValueMap
): DynamicValueMap {
  const normalizedParams = normalizeModelAliasParams(model, params)
  const aliasDefaults = model?.meta.aliasParamDefaults?.[requestedModelId]
  return aliasDefaults ? { ...aliasDefaults, ...normalizedParams } : normalizedParams
}

/**
 * 在 schema 默认值之上应用旧模型别名对应的模式默认值。
 * 这里只处理配置数据，不感知具体模型 ID 或参数名称。
 */
export function applyModelAliasParamDefaults(
  requestedModelId: string,
  model: ModelDefinition | undefined,
  schema: ParamDef[],
  defaults: DynamicValueMap
): DynamicValueMap {
  if (!model || requestedModelId === model.meta.id) return defaults

  const aliasDefaults = model.meta.aliasParamDefaults?.[requestedModelId]
  if (!aliasDefaults) return defaults

  const schemaIds = new Set(schema.map((param) => param.id))
  return Object.entries(aliasDefaults).reduce<DynamicValueMap>((next, [paramId, value]) => {
    if (schemaIds.has(paramId)) next[paramId] = value
    return next
  }, { ...defaults })
}
