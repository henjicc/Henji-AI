/**
 * 自定义模型管理服务
 */

import { nanoid } from 'nanoid'
import { CustomModel, AddCustomModelInput, UpdateCustomModelInput } from '@/core/types/CustomModel'
import { DatabaseService } from '@/services/database/DatabaseService'
import { CustomModelRecord } from '@/services/database/types'
import { registry } from '@/core/registry/ModelRegistry'
import { createModelscopeCustomModelConfig } from './templates/modelscopeTemplate'

/**
 * 自定义模型管理服务
 */
export class CustomModelService {
  private db: DatabaseService

  constructor(db: DatabaseService) {
    this.db = db
  }

  /**
   * 添加自定义模型
   */
  async addCustomModel(input: AddCustomModelInput): Promise<CustomModel> {
    // 1. 生成唯一 ID
    const id = `custom-${nanoid(10)}`

    // 2. 根据 provider 生成配置模板
    const config = this.generateConfig(id, input)

    // 3. 创建数据库记录（适配 CustomModelRecord 结构）
    const dbRecord: Omit<CustomModelRecord, 'createdAt' | 'updatedAt'> = {
      id,
      name: input.name,
      providerId: input.provider,
      baseModel: input.modelUrl,
      config: {
        description: input.description || null,
        modelUrl: input.modelUrl,
        modelConfig: config
      },
      isEnabled: true
    }

    // 4. 保存到数据库
    await this.db.insertCustomModel(dbRecord)

    // 5. 获取保存后的记录并转换为 CustomModel
    const saved = await this.getCustomModelById(id)
    if (!saved) {
      throw new Error('Failed to save custom model')
    }

    // 6. 注册到 ModelRegistry
    this.registerToRegistry(saved)

    return saved
  }

  /**
   * 获取所有自定义模型
   */
  async getCustomModels(): Promise<CustomModel[]> {
    const records = await this.db.getCustomModels()
    return records.map(this.convertToCustomModel)
  }

  /**
   * 获取单个自定义模型
   */
  async getCustomModelById(id: string): Promise<CustomModel | null> {
    const record = await this.db.getCustomModelById(id)
    return record ? this.convertToCustomModel(record) : null
  }

  /**
   * 更新自定义模型
   */
  async updateCustomModel(
    id: string,
    updates: UpdateCustomModelInput
  ): Promise<void> {
    await this.db.updateCustomModel(id, updates)

    // 如果更新了启用状态，需要更新 Registry
    if (updates.isEnabled !== undefined) {
      const model = await this.getCustomModelById(id)
      if (model) {
        if (updates.isEnabled) {
          this.registerToRegistry(model)
        } else {
          this.unregisterFromRegistry(model)
        }
      }
    }
  }

  /**
   * 删除自定义模型
   */
  async deleteCustomModel(id: string): Promise<void> {
    const model = await this.getCustomModelById(id)
    if (model) {
      // 从 Registry 注销
      this.unregisterFromRegistry(model)
    }

    await this.db.deleteCustomModel(id)
  }

  /**
   * 启用自定义模型
   */
  async enableCustomModel(id: string): Promise<void> {
    await this.updateCustomModel(id, { isEnabled: true })
  }

  /**
   * 禁用自定义模型
   */
  async disableCustomModel(id: string): Promise<void> {
    await this.updateCustomModel(id, { isEnabled: false })
  }

  /**
   * 加载所有启用的自定义模型到 Registry
   */
  async loadEnabledModels(): Promise<void> {
    const models = await this.getCustomModels()
    const enabledModels = models.filter(m => m.isEnabled)

    for (const model of enabledModels) {
      this.registerToRegistry(model)
    }

    console.log(`[CustomModelService] Loaded ${enabledModels.length} custom models`)
  }

  /**
   * 注册到 ModelRegistry
   */
  private registerToRegistry(customModel: CustomModel): void {
    registry.register(customModel.config as any)
    console.log(`[CustomModelService] Registered custom model: ${customModel.id}`)
  }

  /**
   * 从 ModelRegistry 注销
   */
  private unregisterFromRegistry(customModel: CustomModel): void {
    registry.unregister(customModel.id)
    console.log(`[CustomModelService] Unregistered custom model: ${customModel.id}`)
  }

  /**
   * 转换数据库记录为 CustomModel
   */
  private convertToCustomModel(record: CustomModelRecord): CustomModel {
    return {
      id: record.id,
      name: record.name,
      description: record.config.description || null,
      provider: record.providerId,
      modelUrl: record.config.modelUrl || record.baseModel || '',
      isEnabled: record.isEnabled,
      config: record.config.modelConfig,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  /**
   * 生成模型配置
   */
  private generateConfig(
    id: string,
    input: AddCustomModelInput
  ): CustomModel['config'] {
    // 目前只支持 ModelScope
    if (input.provider === 'modelscope') {
      return createModelscopeCustomModelConfig(
        id,
        input.name,
        input.modelUrl,
        input.type
      )
    }

    throw new Error(`Unsupported provider: ${input.provider}`)
  }
}

// 单例
let customModelServiceInstance: CustomModelService | null = null

export function getCustomModelService(db: DatabaseService): CustomModelService {
  if (!customModelServiceInstance) {
    customModelServiceInstance = new CustomModelService(db)
  }
  return customModelServiceInstance
}
