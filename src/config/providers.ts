import { getAvailableProviders } from '@/utils/modelHelpers'

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
  tags?: string[]
}

/**
 * 获取当前可用的 Provider 列表（基于 ModelRegistry）
 *
 * 注意：不再依赖 providers.json，统一以模型定义为准。
 */
export function getProviders(): Provider[] {
  return getAvailableProviders() as Provider[]
}

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
  hiddenModels: Set<string>,
  providersData?: Provider[]
): Provider[] {
  // 如果没有传入 providersData，使用注册中心的 Provider 列表
  const sourceProviders = providersData || getProviders()

  return sourceProviders.map(provider => ({
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
