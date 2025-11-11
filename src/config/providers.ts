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
}

// 类型转换，确保数据符合接口定义
export const providers: Provider[] = providersData.providers.map(provider => ({
  ...provider,
  models: provider.models.map(model => ({
    ...model,
    type: model.type as 'image' | 'video' | 'audio'
  }))
}))