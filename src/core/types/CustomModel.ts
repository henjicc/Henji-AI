/**
 * 自定义模型类型定义
 *
 * 用于存储用户添加的自定义模型配置
 */

import { ParamDefinition } from './ModelDefinition'

/**
 * 自定义模型配置
 */
export interface CustomModel {
  id: string
  name: string
  description: string | null
  provider: string
  modelUrl: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string

  // 模型配置（对应 ModelDefinition）
  config: CustomModelConfig
}

/**
 * 自定义模型配置（对应 ModelDefinition）
 */
export interface CustomModelConfig {
  meta: {
    id: string
    name: string
    description: string
    provider: string
    type: 'image' | 'video' | 'audio'
    tags: string[]
  }

  params: ParamDefinition[]

  endpoints: {
    primary: string
  }

  request: {
    baseParams: Record<string, any>
  }

  pricing?: {
    type: 'fixed' | 'dynamic'
    basePrice?: number
    calculate?: (params: Record<string, any>) => number
  }
}

/**
 * 添加自定义模型输入
 */
export interface AddCustomModelInput {
  name: string
  description?: string
  modelUrl: string
  provider: string
  type: 'image' | 'video' | 'audio'
}

/**
 * 更新自定义模型输入
 */
export interface UpdateCustomModelInput {
  name?: string
  description?: string
  isEnabled?: boolean
}
