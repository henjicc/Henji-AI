/**
 * defineModel 辅助函数
 *
 * 用于定义和注册模型，提供类型安全和自动验证
 */

import { ModelDefinition } from './types/ModelDefinition'
import { registry } from './ModelRegistry'
import { validateModel } from './validators/modelValidator'

/**
 * 定义并注册模型
 *
 * 这个函数会：
 * 1. 验证模型定义的完整性和正确性
 * 2. 自动注册到 ModelRegistry
 * 3. 返回验证后的模型定义
 *
 * @param model - 模型定义
 * @returns 验证后的模型定义
 * @throws {ModelValidationError} 如果模型配置无效
 *
 * @example
 * ```typescript
 * import { defineModel } from '@/core'
 *
 * export const seedream45Model = defineModel({
 *   meta: {
 *     id: 'seedream-4.5',
 *     provider: 'ppio',
 *     type: 'image',
 *     name: { zh: '即梦图片 4.5', en: 'Seedream 4.5' }
 *   },
 *   params: [...],
 *   endpoints: '/seedream-4.5',
 *   pricing: { currency: '¥', fixed: 0.15 }
 * })
 * ```
 */
export function defineModel(model: ModelDefinition): ModelDefinition {
  // 1. 验证模型定义
  validateModel(model)

  // 2. 注册到 ModelRegistry
  registry.register(model)

  // 3. 返回验证后的模型定义
  return model
}
