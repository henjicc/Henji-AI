import { registry } from '@/core/ModelRegistry'
import i18n from '@/i18n/config'
import type { I18nText } from '@/core/types/I18nText'
import { getI18nText } from '@/core/types/I18nText'
import type { ModelDefinition } from '@/core/types'
import { PROVIDER_ORDER, MODEL_TYPE_ORDER, compareModelsBySeries } from '@/core/modelSortOrder'
import { getModelAlias } from '@/config/modelAliases'

/**
 * 供应商 ID 到显示名称的映射
 */
const getCurrentLocale = (): string => {
  return i18n.language || i18n.resolvedLanguage || 'zh-CN'
}

const getLocalizedText = (text?: I18nText, locale?: string): string => {
  if (!text) return ''
  return getI18nText(text, locale || getCurrentLocale())
}

/**
 * 解析模型的最终展示名称：用户设置了别名则优先显示别名（按 canonicalModelId
 * 统一生效，不区分供应商），否则回退到模型自身的 i18n 名称。
 */
export function resolveModelName(model: Pick<ModelDefinition, 'meta'>, locale?: string): string {
  const alias = getModelAlias(model.meta.canonicalModelId)
  if (alias) return alias
  return getLocalizedText(model.meta.name, locale || getCurrentLocale()) || model.meta.id
}

/**
 * 获取供应商显示名称
 * @param providerId 供应商 ID
 * @returns 供应商显示名称
 */
export function getProviderDisplayName(providerId: string, locale?: string): string {
  const normalizedProviderId = providerId.trim().toLowerCase()
  if (!normalizedProviderId) return providerId
  const key = `models:providers.${normalizedProviderId}`
  const translated = i18n.t(key, { lng: locale || getCurrentLocale(), defaultValue: providerId })
  return translated || providerId
}

/**
 * 从 ModelRegistry 获取模型显示名称
 * @param modelId 模型 ID
 * @returns 格式化的显示名称，如 "ppio：可灵视频 2.6 Pro"
 */
export function getModelDisplayName(modelId: string, locale?: string): string {
  const model = registry.getModel(modelId)
  if (model) {
    const providerName = getProviderDisplayName(model.meta.provider, locale || getCurrentLocale())
    const modelName = resolveModelName(model, locale)
    return `${providerName}：${modelName}`
  }
  return modelId
}

/**
 * 从 ModelRegistry 获取所有可用的 providers
 * @returns Provider 列表，格式兼容旧的 providers 结构
 */
export function getAvailableProviders() {
  const locale = getCurrentLocale()
  const allModels = registry.listAllModels()
  const providerMap = new Map<string, {
    id: string
    name: string
    type: string
    models: Array<{
      id: string
      canonicalModelId: string
      name: string
      /** 模型自身的原始名称，不受用户别名覆盖，用于别名编辑场景的占位提示 */
      originalName: string
      type: 'image' | 'video' | 'audio'
      description: string
      functions: string[]
      tags?: string[]
      seriesId?: string
      seriesRank?: number
    }>
  }>()

  allModels.forEach(model => {
    const providerId = model.meta.provider
    if (!providerMap.has(providerId)) {
      providerMap.set(providerId, {
        id: providerId,
        name: getProviderDisplayName(providerId, locale),
        type: 'api',
        models: []
      })
    }

    providerMap.get(providerId)!.models.push({
      id: model.meta.id,
      canonicalModelId: model.meta.canonicalModelId,
      name: resolveModelName(model, locale),
      originalName: getLocalizedText(model.meta.name, locale) || model.meta.id,
      type: model.meta.type,
      description: model.meta.description ? getLocalizedText(model.meta.description, locale) : '',
      functions: model.meta.tags || [],
      tags: model.meta.tags,
      seriesId: model.meta.seriesId,
      seriesRank: model.meta.seriesRank
    })
  })

  const providers = Array.from(providerMap.values())

  providers.forEach((provider) => {
    provider.models.sort((a, b) => {
      const typeDiff = MODEL_TYPE_ORDER[a.type] - MODEL_TYPE_ORDER[b.type]
      if (typeDiff !== 0) return typeDiff
      return compareModelsBySeries(a, b)
    })
  })

  providers.sort((a, b) => {
    const orderA = PROVIDER_ORDER[a.id] ?? Number.MAX_SAFE_INTEGER
    const orderB = PROVIDER_ORDER[b.id] ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  })

  return providers
}

/**
 * 从 ModelRegistry 获取模型信息
 * @param modelId 模型 ID
 * @returns 模型信息，格式兼容旧的 model 结构
 */
export function getModelInfo(modelId: string) {
  const locale = getCurrentLocale()
  const model = registry.getModel(modelId)
  if (!model) return null

  const name = resolveModelName(model, locale)
  const description = model.meta.description ? getLocalizedText(model.meta.description, locale) : ''

  return {
    id: model.meta.id,
    name,
    type: model.meta.type,
    description,
    functions: model.meta.tags || [],
    tags: model.meta.tags
  }
}
