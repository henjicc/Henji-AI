import { registry } from '@/core/ModelRegistry'

/**
 * 供应商 ID 到显示名称的映射
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'ppio': '派欧云',
  'fal': 'fal',
  'modelscope': '魔搭',
  'kie': 'KIE'
}

/**
 * 获取供应商显示名称
 * @param providerId 供应商 ID
 * @returns 供应商显示名称
 */
export function getProviderDisplayName(providerId: string): string {
  return PROVIDER_DISPLAY_NAMES[providerId] || providerId
}

/**
 * 从 ModelRegistry 获取模型显示名称
 * @param modelId 模型 ID
 * @returns 格式化的显示名称，如 "ppio：可灵视频 2.6 Pro"
 */
export function getModelDisplayName(modelId: string): string {
  const modelInfo = registry.getModelInfo(modelId)
  if (modelInfo) {
    const providerName = getProviderDisplayName(modelInfo.provider)
    // 处理 name 字段：可能是字符串或 I18nText 对象
    const modelName = typeof modelInfo.name === 'string'
      ? modelInfo.name
      : (modelInfo.name?.zh || modelInfo.name?.en || modelId)
    return `${providerName}：${modelName}`
  }
  return modelId
}

/**
 * 从 ModelRegistry 获取所有可用的 providers
 * @returns Provider 列表，格式兼容旧的 providers 结构
 */
export function getAvailableProviders() {
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
        name: getProviderDisplayName(providerId),
        type: 'api',
        models: []
      })
    }

    providerMap.get(providerId)!.models.push({
      id: model.meta.id,
      name: typeof model.meta.name === 'string' ? model.meta.name : (model.meta.name.zh || model.meta.name.en),
      type: model.meta.type,
      description: model.meta.description ? (typeof model.meta.description === 'string' ? model.meta.description : (model.meta.description.zh || model.meta.description.en || '')) : '',
      functions: model.meta.tags || [],
      tags: model.meta.tags
    })
  })

  return Array.from(providerMap.values())
}

/**
 * 从 ModelRegistry 获取模型信息
 * @param modelId 模型 ID
 * @returns 模型信息，格式兼容旧的 model 结构
 */
export function getModelInfo(modelId: string) {
  const modelInfo = registry.getModelInfo(modelId)
  if (!modelInfo) return null

  // 处理 name 字段：可能是字符串或 I18nText 对象
  const name = typeof modelInfo.name === 'string'
    ? modelInfo.name
    : (modelInfo.name?.zh || modelInfo.name?.en || '')

  // 处理 description 字段：可能是字符串或 I18nText 对象
  const description = typeof modelInfo.description === 'string'
    ? modelInfo.description
    : (modelInfo.description?.zh || modelInfo.description?.en || '')

  return {
    id: modelInfo.id,
    name,
    type: modelInfo.type,
    description,
    functions: modelInfo.tags || [],
    tags: modelInfo.tags
  }
}
