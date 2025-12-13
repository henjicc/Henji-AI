import providersData from './providers.json'

export interface Provider {
  id: string
  name: string
  type: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  type: 'image' | 'video' | 'audio'
  description: string
  functions: string[]
}

// 类型转换，确保数据符合接口定义
export const providers: Provider[] = providersData.providers.map(provider => ({
  ...provider,
  models: provider.models.map(model => ({
    ...model,
    type: model.type as 'image' | 'video' | 'audio'
  }))
}))

// 获取隐藏的供应商列表
export function getHiddenProviders(): Set<string> {
  try {
    const stored = localStorage.getItem('hidden_providers')
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

// 保存隐藏的供应商列表
export function saveHiddenProviders(hiddenProviders: Set<string>): void {
  localStorage.setItem('hidden_providers', JSON.stringify(Array.from(hiddenProviders)))
}

// 获取隐藏的类型列表
export function getHiddenTypes(): Set<string> {
  try {
    const stored = localStorage.getItem('hidden_types')
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

// 保存隐藏的类型列表
export function saveHiddenTypes(hiddenTypes: Set<string>): void {
  localStorage.setItem('hidden_types', JSON.stringify(Array.from(hiddenTypes)))
}

// 获取隐藏的单个模型列表
export function getHiddenModels(): Set<string> {
  try {
    const stored = localStorage.getItem('hidden_models')
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

// 保存隐藏的单个模型列表
export function saveHiddenModels(hiddenModels: Set<string>): void {
  localStorage.setItem('hidden_models', JSON.stringify(Array.from(hiddenModels)))
}

// 获取过滤后的可见模型列表
export function getVisibleProviders(
  hiddenProviders: Set<string>,
  hiddenTypes: Set<string>,
  hiddenModels: Set<string>
): Provider[] {
  return providers.map(provider => ({
    ...provider,
    models: provider.models.filter(model => {
      // 供应商被隐藏
      if (hiddenProviders.has(provider.id)) return false
      // 类型被隐藏
      if (hiddenTypes.has(model.type)) return false
      // 单个模型被隐藏
      if (hiddenModels.has(`${provider.id}-${model.id}`)) return false
      return true
    })
  })).filter(provider => provider.models.length > 0)
}