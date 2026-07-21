import { createLogger } from '@/core/logging'

const logger = createLogger('core.ModelRegistry')
/**
 * 模型注册中心
 *
 * 管理所有模型的注册、查询、价格计算、端点选择等核心功能
 */

import {
  ModelDefinition,
  ParamDef,
  ModelType,
  ProviderId,
  ModelTag,
  getI18nText
} from './types'
import { validateModel } from './validators/modelValidator'
import { EndpointSelector } from './request/EndpointSelector'
import { compareModelsBySeries } from './modelSortOrder'

/**
 * 模型注册中心类
 *
 * 使用单例模式确保全局唯一实例
 */
export class ModelRegistry {
  private static instance: ModelRegistry

  /**
   * 模型存储（主索引）
   *
   * Key: 模型 ID 或别名
   * Value: 模型定义
   */
  private models: Map<string, ModelDefinition> = new Map()

  /**
   * 按供应商索引
   *
   * Key: Provider ID
   * Value: Set of Model IDs
   */
  private modelsByProvider: Map<ProviderId, Set<string>> = new Map()

  /**
   * 按类型索引
   *
   * Key: Model Type
   * Value: Set of Model IDs
   */
  private modelsByType: Map<ModelType, Set<string>> = new Map()

  /**
   * 按标签索引
   *
   * Key: Model Tag
   * Value: Set of Model IDs
   */
  private modelsByTag: Map<ModelTag, Set<string>> = new Map()

  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {}

  /**
   * 获取单例实例
   *
   * @returns ModelRegistry 实例
   */
  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry()
    }
    return ModelRegistry.instance
  }

  /**
   * 注册模型
   *
   * @param model - 模型定义
   * @throws {ModelValidationError} 如果模型配置无效
   * @throws {Error} 如果模型 ID 已存在
   *
   * @example
   * ```typescript
   * registry.register({
   *   meta: {
   *     id: 'nano-banana',
   *     provider: 'fal',
   *     type: 'image',
   *     name: { zh: 'Nano Banana', en: 'Nano Banana' }
   *   },
   *   params: [...],
   *   endpoints: '/fal-ai/nano-banana',
   *   pricing: { currency: '¥', fixed: 0.1 }
   * })
   * ```
   */
  register(model: ModelDefinition): void {
    // 1. 检查 ID 是否已存在
    if (this.models.has(model.meta.id)) {
      throw new Error(`Model ID already exists: ${model.meta.id}`)
    }

    // 2. 验证模型配置
    validateModel(model)

    // 3. 注册主 ID
    this.models.set(model.meta.id, model)

    // 4. 注册别名
    model.meta.aliases?.forEach((alias) => {
      if (this.models.has(alias)) {
        logger.warn(`Alias "${alias}" already exists, skipping for model ${model.meta.id}`)
      } else {
        this.models.set(alias, model)
      }
    })

    // 5. 构建索引：按供应商
    if (!this.modelsByProvider.has(model.meta.provider)) {
      this.modelsByProvider.set(model.meta.provider, new Set())
    }
    this.modelsByProvider.get(model.meta.provider)!.add(model.meta.id)

    // 6. 构建索引：按类型
    if (!this.modelsByType.has(model.meta.type)) {
      this.modelsByType.set(model.meta.type, new Set())
    }
    this.modelsByType.get(model.meta.type)!.add(model.meta.id)

    // 7. 构建索引：按标签
    model.meta.tags?.forEach((tag) => {
      if (!this.modelsByTag.has(tag)) {
        this.modelsByTag.set(tag, new Set())
      }
      this.modelsByTag.get(tag)!.add(model.meta.id)
    })
  }

  /**
   * 注销模型
   *
   * @param modelId - 模型 ID
   */
  unregister(modelId: string): void {
    const model = this.models.get(modelId)
    if (!model) {
      logger.warn(`Model not found: ${modelId}`)
      return
    }

    // 1. 从主索引删除
    this.models.delete(modelId)

    // 2. 删除别名
    model.meta.aliases?.forEach((alias) => {
      this.models.delete(alias)
    })

    // 3. 从供应商索引删除
    this.modelsByProvider.get(model.meta.provider)?.delete(modelId)

    // 4. 从类型索引删除
    this.modelsByType.get(model.meta.type)?.delete(modelId)

    // 5. 从标签索引删除
    model.meta.tags?.forEach((tag) => {
      this.modelsByTag.get(tag)?.delete(modelId)
    })
  }

  /**
   * 批量注册模型
   *
   * @param models - 模型定义数组
   * @returns 成功注册的模型数量
   *
   * @example
   * ```typescript
   * const count = registry.registerBatch([model1, model2, model3])
   * logger.info(`Successfully registered ${count} models`)
   * ```
   */
  registerBatch(models: ModelDefinition[]): number {
    let successCount = 0

    models.forEach((model) => {
      try {
        this.register(model)
        successCount++
      } catch (error) {
        logger.error(`Failed to register model ${model.meta.id}:`, error)
      }
    })

    return successCount
  }

  /**
   * 获取模型定义
   *
   * @param id - 模型 ID 或别名
   * @returns 模型定义，如果不存在则返回 undefined
   *
   * @example
   * ```typescript
   * const model = registry.getModel('nano-banana')
   * if (model) {
   *   logger.info(model.meta.name)
   * }
   * ```
   */
  getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id)
  }

  /**
   * 检查模型是否存在
   *
   * @param id - 模型 ID 或别名
   * @returns 是否存在
   */
  hasModel(id: string): boolean {
    return this.models.has(id)
  }

  /**
   * 获取参数 Schema
   *
   * @param id - 模型 ID 或别名
   * @returns 参数定义数组，如果模型不存在则返回空数组
   *
   * @example
   * ```typescript
   * const schema = registry.getSchema('nano-banana')
   * schema.forEach(param => {
   *   logger.info(param.id, param.type, param.default)
   * })
   * ```
   */
  getSchema(id: string): ParamDef[] {
    const model = this.models.get(id)
    return model?.params || []
  }

  /**
   * 获取参数默认值
   *
   * @param id - 模型 ID 或别名
   * @returns 参数默认值对象
   *
   * @example
   * ```typescript
   * const defaults = registry.getDefaultValues('nano-banana')
   * // { prompt: '', aspectRatio: '1:1', numImages: 1, ... }
   * ```
   */
  getDefaultValues(id: string): DynamicValueMap {
    const schema = this.getSchema(id)
    const defaults: DynamicValueMap = {}

    schema.forEach((param) => {
      defaults[param.id] = param.default
    })

    return defaults
  }

  /**
   * 按供应商查询模型
   *
   * @param provider - Provider ID
   * @returns 模型定义数组
   *
   * @example
   * ```typescript
   * const falModels = registry.getModelsByProvider('fal')
   * ```
   */
  getModelsByProvider(provider: ProviderId): ModelDefinition[] {
    const ids = this.modelsByProvider.get(provider)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.models.get(id)!)
      .filter(Boolean)
  }

  /**
   * 按类型查询模型
   *
   * @param type - 模型类型
   * @returns 模型定义数组
   *
   * @example
   * ```typescript
   * const imageModels = registry.getModelsByType('image')
   * const videoModels = registry.getModelsByType('video')
   * ```
   */
  getModelsByType(type: ModelType): ModelDefinition[] {
    const ids = this.modelsByType.get(type)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.models.get(id)!)
      .filter(Boolean)
      .sort((a, b) => compareModelsBySeries(
        { id: a.meta.id, name: getI18nText(a.meta.name, 'en'), seriesId: a.meta.seriesId, seriesRank: a.meta.seriesRank },
        { id: b.meta.id, name: getI18nText(b.meta.name, 'en'), seriesId: b.meta.seriesId, seriesRank: b.meta.seriesRank }
      ))
  }

  /**
   * 按标签查询模型
   *
   * @param tag - 模型标签
   * @returns 模型定义数组
   *
   * @example
   * ```typescript
   * const modelsWithImageEditing = registry.getModelsByTag('supports-image-editing')
   * const fastModels = registry.getModelsByTag('fast-generation')
   * ```
   */
  getModelsByTag(tag: ModelTag): ModelDefinition[] {
    const ids = this.modelsByTag.get(tag)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.models.get(id)!)
      .filter(Boolean)
  }

  /**
   * 计算价格
   *
   * @param modelId - 模型 ID 或别名
   * @param params - 参数值对象
   * @returns 价格（失败时返回 0）
   *
   * @example
   * ```typescript
   * const price = registry.calculatePrice('nano-banana', {
   *   numImages: 4,
   *   aspectRatio: '16:9'
   * })
   * logger.info(`Price: ¥${price.toFixed(2)}`)
   * ```
   */
  calculatePrice(modelId: string, params: DynamicValueMap): number {
    const model = this.models.get(modelId)
    if (!model) {
      logger.warn(`Model not found: ${modelId}`)
      return 0
    }

    try {
      const { pricing } = model

      // 1. 固定价格
      if (pricing.fixed !== undefined) {
        return pricing.fixed
      }

      // 2. 动态计算
      if (pricing.calculator) {
        return pricing.calculator(params)
      }

      // 3. 默认返回 0
      return 0
    } catch (error) {
      logger.error(`Price calculation failed for ${modelId}:`, error)
      return 0
    }
  }

  /**
   * 选择 API 端点
   *
   * @param modelId - 模型 ID 或别名
   * @param params - 参数值对象
   * @returns 端点 URL，如果无法选择则返回 undefined
   *
   * @example
   * ```typescript
   * const endpoint = registry.selectEndpoint('nano-banana', {
   *   hasImage: true
   * })
   * // 返回: '/fal-ai/image-to-image' 或 '/fal-ai/text-to-image'
   * ```
   */
  async selectEndpoint(modelId: string, params: DynamicValueMap): Promise<string | undefined> {
    const model = this.models.get(modelId)
    if (!model) {
      logger.warn(`Model not found: ${modelId}`)
      return undefined
    }

    try {
      const selector = new EndpointSelector(model.endpoints)
      const result = await selector.select(params, {})
      return result.endpoint
    } catch (error) {
      logger.error(`Endpoint selection failed for ${modelId}:`, error)
      return undefined
    }
  }

  /**
   * 列出所有模型
   *
   * @returns 所有模型定义数组（不包含别名重复）
   *
   * @example
   * ```typescript
   * const allModels = registry.listAllModels()
   * logger.info(`Total models: ${allModels.length}`)
   * ```
   */
  listAllModels(): ModelDefinition[] {
    const uniqueModels = new Map<string, ModelDefinition>()

    this.models.forEach((model, id) => {
      // 只添加主 ID，跳过别名
      if (id === model.meta.id) {
        uniqueModels.set(id, model)
      }
    })

    return Array.from(uniqueModels.values())
  }

  /**
   * 获取模型详细信息
   *
   * @param id - 模型 ID 或别名
   * @returns 模型详细信息对象
   *
   * @example
   * ```typescript
   * const info = registry.getModelInfo('nano-banana')
   * logger.info(info)
   * // {
   * //   id: 'nano-banana',
   * //   provider: 'fal',
   * //   type: 'image',
   * //   paramCount: 10,
   * //   linkageCount: 5,
   * //   tags: ['text-to-image', 'image-to-image'],
   * //   hasAliases: true,
   * //   aliases: ['fal-nano-banana']
   * // }
   * ```
   */
  getModelInfo(id: string): DynamicValueMap | undefined {
    const model = this.models.get(id)
    if (!model) return undefined

    return {
      id: model.meta.id,
      provider: model.meta.provider,
      type: model.meta.type,
      name: model.meta.name,
      description: model.meta.description,
      paramCount: model.params.length,
      linkageCount: model.linkages?.length || 0,
      tags: model.meta.tags || [],
      hasAliases: (model.meta.aliases?.length || 0) > 0,
      aliases: model.meta.aliases || [],
      polling: model.meta.polling,
      pricingType: model.pricing.fixed !== undefined ? 'fixed' : 'dynamic',
      currency: model.pricing.currency
    }
  }

  /**
   * 获取统计信息
   *
   * @returns 注册中心统计信息
   *
   * @example
   * ```typescript
   * const stats = registry.getStats()
   * logger.info(stats)
   * // {
   * //   totalModels: 50,
   * //   totalAliases: 75,
   * //   providers: ['ppio', 'fal', 'kie', 'modelscope'],
   * //   imageModels: 30,
   * //   videoModels: 18,
   * //   audioModels: 2
   * // }
   * ```
   */
  getStats(): DynamicValueMap {
    const allModels = this.listAllModels()
    const totalEntries = this.models.size
    const totalModels = allModels.length
    const totalAliases = totalEntries - totalModels

    return {
      totalModels,
      totalAliases,
      totalEntries,
      providers: Array.from(this.modelsByProvider.keys()),
      providerCounts: Object.fromEntries(
        Array.from(this.modelsByProvider.entries()).map(([provider, ids]) => [provider, ids.size])
      ),
      imageModels: this.modelsByType.get('image')?.size || 0,
      videoModels: this.modelsByType.get('video')?.size || 0,
      audioModels: this.modelsByType.get('audio')?.size || 0,
      topTags: this.getTopTags(10)
    }
  }

  /**
   * 获取最常用的标签
   *
   * @param limit - 返回的标签数量
   * @returns 标签及其使用次数数组
   */
  private getTopTags(limit: number): Array<{ tag: string; count: number }> {

    const tagCounts = Array.from(this.modelsByTag.entries()).map(([tag, ids]) => ({
      tag,
      count: ids.size
    }))

    return tagCounts.sort((a, b) => b.count - a.count).slice(0, limit)
  }

  /**
   * 清空所有注册的模型（仅用于测试）
   */
  clear(): void {
    this.models.clear()
    this.modelsByProvider.clear()
    this.modelsByType.clear()
    this.modelsByTag.clear()
  }
}

/**
 * 全局单例实例
 *
 * @example
 * ```typescript
 * import { registry } from '@/core'
 *
 * registry.register(myModel)
 * const model = registry.getModel('nano-banana')
 * ```
 */
export const registry = ModelRegistry.getInstance()
