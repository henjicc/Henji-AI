import { createLogger } from '@/core/logging'
import { replaceModelscopeCustomModels } from '@/models/modelscope/customModelRegistry'
import { databaseService } from '@/services/database'
import type { CustomModelRecord } from '@/services/database'

const logger = createLogger('services.modelscopeCustomModels.ModelscopeCustomModelService')

const PROVIDER_ID = 'modelscope'
const CONFIG_KIND = 'modelscope-custom-model-ref'
const LEGACY_STORAGE_KEY = 'modelscope_custom_models'

export interface ModelscopeCustomModelType {
  imageGeneration: boolean
  imageEditing: boolean
}

export interface ModelscopeCustomModelEntry {
  id: string
  name: string
  modelType: ModelscopeCustomModelType
}

interface ModelscopeCustomModelConfig extends DynamicValueMap {
  kind: typeof CONFIG_KIND
  modelType: ModelscopeCustomModelType
}

function normalizeModelType(raw: DynamicValue): ModelscopeCustomModelType {
  if (!raw || typeof raw !== 'object') {
    return { imageGeneration: true, imageEditing: false }
  }

  const record = raw as DynamicValueMap
  const imageGeneration = record.imageGeneration === true
  const imageEditing = record.imageEditing === true && !imageGeneration

  if (!imageGeneration && !imageEditing) {
    return { imageGeneration: true, imageEditing: false }
  }

  return { imageGeneration, imageEditing }
}

function parseLegacyModels(raw: string | null): ModelscopeCustomModelEntry[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as DynamicValue
    if (!Array.isArray(parsed)) return []

    const models: ModelscopeCustomModelEntry[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as DynamicValueMap
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!id) continue
      const name = typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : id
      models.push({
        id,
        name,
        modelType: normalizeModelType(record.modelType),
      })
    }

    return models
  } catch (error) {
    logger.warn('Failed to parse legacy ModelScope custom models:', error)
    return []
  }
}

function createConfig(modelType: ModelscopeCustomModelType): ModelscopeCustomModelConfig {
  return {
    kind: CONFIG_KIND,
    modelType,
  }
}

function isModelscopeCustomModelRecord(record: CustomModelRecord): boolean {
  return record.providerId === PROVIDER_ID && record.config.kind === CONFIG_KIND
}

function toEntry(record: CustomModelRecord): ModelscopeCustomModelEntry {
  return {
    id: record.id,
    name: record.name,
    modelType: normalizeModelType(record.config.modelType),
  }
}

class ModelscopeCustomModelService {
  private legacyMigrated = false

  async loadModelsToRegistry(): Promise<void> {
    const models = await this.listModels()
    replaceModelscopeCustomModels(models)
  }

  async listModels(): Promise<ModelscopeCustomModelEntry[]> {
    await this.ensureReady()
    const records = await databaseService.getCustomModels(PROVIDER_ID)
    const models = records
      .filter(isModelscopeCustomModelRecord)
      .map(toEntry)
    replaceModelscopeCustomModels(models)
    return models
  }

  async addModel(model: ModelscopeCustomModelEntry): Promise<void> {
    await this.ensureReady()
    const existing = await databaseService.getCustomModelById(model.id)
    if (existing) {
      throw new Error(`ModelScope custom model "${model.id}" already exists.`)
    }

    await databaseService.insertCustomModel({
      id: model.id,
      name: model.name,
      providerId: PROVIDER_ID,
      baseModel: model.id,
      config: createConfig(model.modelType),
      isEnabled: true,
    })
    await this.loadModelsToRegistry()
  }

  async updateModel(id: string, updates: Pick<ModelscopeCustomModelEntry, 'name' | 'modelType'>): Promise<void> {
    await this.ensureReady()
    await databaseService.updateCustomModel(id, {
      name: updates.name,
      config: createConfig(updates.modelType),
    })
    await this.loadModelsToRegistry()
  }

  async deleteModel(id: string): Promise<void> {
    await this.ensureReady()
    await databaseService.deleteCustomModel(id)
    await this.loadModelsToRegistry()
  }

  private async ensureReady(): Promise<void> {
    await databaseService.init()
    await this.migrateLegacyModels()
  }

  private async migrateLegacyModels(): Promise<void> {
    if (this.legacyMigrated || typeof window === 'undefined') return
    this.legacyMigrated = true

    const legacyModels = parseLegacyModels(window.localStorage.getItem(LEGACY_STORAGE_KEY))
    if (legacyModels.length === 0) return

    for (const model of legacyModels) {
      const existing = await databaseService.getCustomModelById(model.id)
      if (existing) continue
      await databaseService.insertCustomModel({
        id: model.id,
        name: model.name,
        providerId: PROVIDER_ID,
        baseModel: model.id,
        config: createConfig(model.modelType),
        isEnabled: true,
      })
    }

    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
}

export const modelscopeCustomModelService = new ModelscopeCustomModelService()
