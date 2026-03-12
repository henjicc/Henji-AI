import { registry } from '@/core/ModelRegistry'
import i18n from '@/i18n/config'
import type { I18nText } from '@/core/types/I18nText'
import { getI18nText } from '@/core/types/I18nText'

const PROVIDER_ORDER: Record<string, number> = {
  ppio: 0,
  kie: 1,
  modelscope: 2,
  fal: 3
}

const MODEL_TYPE_ORDER: Record<'image' | 'video' | 'audio', number> = {
  image: 0,
  video: 1,
  audio: 2
}

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
 * 获取供应商显示名称
 * @param providerId 供应商 ID
 * @returns 供应商显示名称
 */
export function getProviderDisplayName(providerId: string, locale?: string): string {
  const key = `models:providers.${providerId}`
  const translated = i18n.t(key, { lng: locale || getCurrentLocale(), defaultValue: providerId })
  return translated || providerId
}

/**
 * 从 ModelRegistry 获取模型显示名称
 * @param modelId 模型 ID
 * @returns 格式化的显示名称，如 "ppio：可灵视频 2.6 Pro"
 */
export function getModelDisplayName(modelId: string, locale?: string): string {
  const modelInfo = registry.getModelInfo(modelId)
  if (modelInfo) {
    const providerName = getProviderDisplayName(modelInfo.provider, locale || getCurrentLocale())
    const modelName = getLocalizedText(modelInfo.name, locale || getCurrentLocale()) || modelId
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
      name: string
      type: 'image' | 'video' | 'audio'
      description: string
      functions: string[]
      tags?: string[]
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
      name: getLocalizedText(model.meta.name, locale),
      type: model.meta.type,
      description: model.meta.description ? getLocalizedText(model.meta.description, locale) : '',
      functions: model.meta.tags || [],
      tags: model.meta.tags
    })
  })

  const providers = Array.from(providerMap.values())

  providers.forEach((provider) => {
    provider.models.sort((a, b) => {
      const typeDiff = MODEL_TYPE_ORDER[a.type] - MODEL_TYPE_ORDER[b.type]
      if (typeDiff !== 0) return typeDiff
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
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
  const modelInfo = registry.getModelInfo(modelId)
  if (!modelInfo) return null

  const name = getLocalizedText(modelInfo.name, locale)
  const description = modelInfo.description ? getLocalizedText(modelInfo.description, locale) : ''

  return {
    id: modelInfo.id,
    name,
    type: modelInfo.type,
    description,
    functions: modelInfo.tags || [],
    tags: modelInfo.tags
  }
}
