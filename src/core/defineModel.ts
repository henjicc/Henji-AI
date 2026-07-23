/**
 * defineModel 辅助函数
 *
 * 用于定义和注册模型，提供类型安全和自动验证
 */

import { ModelDefinition } from './types/ModelDefinition'
import { registry } from './ModelRegistry'
import { getGenerationModelDescription } from './modelCatalog/generationModelDescriptions'
import { validateModel } from './validators/modelValidator'

function applyCanonicalDescription(model: ModelDefinition): ModelDefinition {
  const description = getGenerationModelDescription(model.meta.canonicalModelId)
  if (description) {
    model.meta.description = description
  } else {
    delete model.meta.description
  }
  return model
}

function applyI18nScope(model: ModelDefinition): ModelDefinition {
  const scope = model.meta.i18nScope
  if (!scope || typeof scope !== 'string') {
    return model
  }

  const visit = (value: DynamicValue): void => {
    if (!value) return
    if (typeof value === 'function') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'object') return

    const obj = value as DynamicValueMap
    const keyValue = obj.key
    if (typeof keyValue === 'string') {
      const absolute = obj.absolute === true
      if (absolute) return
      if (!keyValue.startsWith(`${scope}.`)) {
        obj.key = `${scope}.${keyValue.replace(/^\./, '')}`
      }
      return
    }

    Object.keys(obj).forEach((k) => {
      visit(obj[k])
    })
  }

  visit(model)
  return model
}

/**
 * 定义并注册模型
 *
 * 这个函数会：
 * 1. 按 canonicalModelId 解析通用描述
 * 2. 预处理 i18n key（应用 i18nScope）
 * 3. 验证模型定义的完整性和正确性
 * 4. 自动注册到 ModelRegistry
 * 5. 返回验证后的模型定义
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
 *     canonicalModelId: 'seedream-4.5',
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
  // 1. 按跨供应商模型标识解析唯一的通用描述
  applyCanonicalDescription(model)

  // 2. 预处理 i18n key
  applyI18nScope(model)

  // 3. 验证模型定义
  validateModel(model)

  // 4. 注册到 ModelRegistry
  registry.register(model)

  // 5. 返回验证后的模型定义
  return model
}
