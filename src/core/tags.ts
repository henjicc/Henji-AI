/**
 * 模型标签系统工具函数
 */

import { ModelTag } from './types/ModelTags'
import { providers } from '../config/providers'

/**
 * 模型标签映射表（运行时构建）
 */
let modelTagsMap: Map<string, Set<ModelTag>> | null = null

/**
 * 初始化标签映射表
 */
function initializeTagsMap(): Map<string, Set<ModelTag>> {
  if (modelTagsMap) {
    return modelTagsMap
  }

  const map = new Map<string, Set<ModelTag>>()

  // 遍历所有 providers 和 models
  providers.forEach(provider => {
    provider.models.forEach(model => {
      const tags = new Set<ModelTag>()

      // 从 providers.json 中读取 tags 字段
      if (model.tags && Array.isArray(model.tags)) {
        model.tags.forEach(tag => tags.add(tag as ModelTag))
      }

      map.set(model.id, tags)
    })
  })

  modelTagsMap = map
  return map
}

/**
 * 检查模型是否有指定标签
 *
 * @param modelId - 模型ID
 * @param tag - 标签名称
 * @returns 是否有该标签
 *
 * @example
 * ```typescript
 * // 检查是否支持图片编辑
 * if (hasTag('nano-banana', 'supports-image-editing')) {
 *   // 显示图片上传组件
 * }
 *
 * // 检查是否需要图片
 * if (hasTag('kie-hailuo-2-3', 'requires-image')) {
 *   // 必须上传图片才能生成
 * }
 * ```
 */
export function hasTag(modelId: string, tag: ModelTag): boolean {
  const map = initializeTagsMap()
  const tags = map.get(modelId)
  return tags ? tags.has(tag) : false
}

/**
 * 检查模型是否有任一指定标签
 *
 * @param modelId - 模型ID
 * @param tags - 标签数组
 * @returns 是否有任一标签
 *
 * @example
 * ```typescript
 * // 检查是否支持图片编辑或多图上传
 * if (hasAnyTag('nano-banana', ['supports-image-editing', 'supports-multi-image'])) {
 *   // ...
 * }
 * ```
 */
export function hasAnyTag(modelId: string, tags: ModelTag[]): boolean {
  return tags.some(tag => hasTag(modelId, tag))
}

/**
 * 检查模型是否有所有指定标签
 *
 * @param modelId - 模型ID
 * @param tags - 标签数组
 * @returns 是否有所有标签
 *
 * @example
 * ```typescript
 * // 检查是否同时支持图片编辑和多图上传
 * if (hasAllTags('nano-banana', ['supports-image-editing', 'supports-multi-image'])) {
 *   // ...
 * }
 * ```
 */
export function hasAllTags(modelId: string, tags: ModelTag[]): boolean {
  return tags.every(tag => hasTag(modelId, tag))
}

/**
 * 获取模型的所有标签
 *
 * @param modelId - 模型ID
 * @returns 标签数组
 *
 * @example
 * ```typescript
 * const tags = getModelTags('nano-banana')
 * console.log(tags) // ['text-to-image', 'supports-image-editing', ...]
 * ```
 */
export function getModelTags(modelId: string): ModelTag[] {
  const map = initializeTagsMap()
  const tags = map.get(modelId)
  return tags ? Array.from(tags) : []
}

/**
 * 获取有指定标签的所有模型
 *
 * @param tag - 标签名称
 * @returns 模型ID数组
 *
 * @example
 * ```typescript
 * // 获取所有支持图片编辑的模型
 * const models = getModelsByTag('supports-image-editing')
 * console.log(models) // ['nano-banana', 'seedream-4.0', ...]
 * ```
 */
export function getModelsByTag(tag: ModelTag): string[] {
  const map = initializeTagsMap()
  const models: string[] = []

  map.forEach((tags, modelId) => {
    if (tags.has(tag)) {
      models.push(modelId)
    }
  })

  return models
}

/**
 * 获取有任一指定标签的所有模型
 *
 * @param tags - 标签数组
 * @returns 模型ID数组
 *
 * @example
 * ```typescript
 * // 获取所有支持图片编辑或多图上传的模型
 * const models = getModelsByAnyTag(['supports-image-editing', 'supports-multi-image'])
 * ```
 */
export function getModelsByAnyTag(tags: ModelTag[]): string[] {
  const map = initializeTagsMap()
  const models: string[] = []

  map.forEach((modelTags, modelId) => {
    if (tags.some(tag => modelTags.has(tag))) {
      models.push(modelId)
    }
  })

  return models
}

/**
 * 获取有所有指定标签的模型
 *
 * @param tags - 标签数组
 * @returns 模型ID数组
 *
 * @example
 * ```typescript
 * // 获取所有同时支持图片编辑和多图上传的模型
 * const models = getModelsByAllTags(['supports-image-editing', 'supports-multi-image'])
 * ```
 */
export function getModelsByAllTags(tags: ModelTag[]): string[] {
  const map = initializeTagsMap()
  const models: string[] = []

  map.forEach((modelTags, modelId) => {
    if (tags.every(tag => modelTags.has(tag))) {
      models.push(modelId)
    }
  })

  return models
}

/**
 * 清除标签映射表缓存
 * （用于热重载或测试）
 */
export function clearTagsCache(): void {
  modelTagsMap = null
}
