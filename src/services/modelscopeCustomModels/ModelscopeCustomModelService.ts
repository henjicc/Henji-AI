import { createLogger } from '@/core/logging'
import { replaceModelscopeCustomModels } from '@henjicc/ai-sdk'
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
  costTier?: string
  magicGrainCost?: number
  modelType: ModelscopeCustomModelType
}

interface ModelscopeCustomModelConfig extends DynamicValueMap {
  kind: typeof CONFIG_KIND
  modelType: ModelscopeCustomModelType
  costTier?: string
  magicGrainCost?: number
}

function normalizeCostTier(raw: DynamicValue): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined
}

function normalizeMagicGrainCost(raw: DynamicValue): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
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
      const costTier = normalizeCostTier(record.costTier)
      const magicGrainCost = normalizeMagicGrainCost(record.magicGrainCost)
      models.push({
        id,
        name,
        ...(costTier ? { costTier } : {}),
        ...(magicGrainCost !== undefined ? { magicGrainCost } : {}),
        modelType: normalizeModelType(record.modelType),
      })
    }

    return models
  } catch (error) {
    logger.warn('Failed to parse legacy ModelScope custom models:', error)
    return []
  }
}

function createConfig(
  modelType: ModelscopeCustomModelType,
  pricing: Pick<ModelscopeCustomModelEntry, 'costTier' | 'magicGrainCost'> = {}
): ModelscopeCustomModelConfig {
  const costTier = normalizeCostTier(pricing.costTier)
  const magicGrainCost = normalizeMagicGrainCost(pricing.magicGrainCost)
  return {
    kind: CONFIG_KIND,
    modelType,
    ...(costTier ? { costTier } : {}),
    ...(magicGrainCost !== undefined ? { magicGrainCost } : {}),
  }
}

function isModelscopeCustomModelRecord(record: CustomModelRecord): boolean {
  return record.providerId === PROVIDER_ID && record.config.kind === CONFIG_KIND
}

function toEntry(record: CustomModelRecord): ModelscopeCustomModelEntry {
  const costTier = normalizeCostTier(record.config.costTier)
  const magicGrainCost = normalizeMagicGrainCost(record.config.magicGrainCost)
  return {
    id: record.id,
    name: record.name,
    ...(costTier ? { costTier } : {}),
    ...(magicGrainCost !== undefined ? { magicGrainCost } : {}),
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
      config: createConfig(model.modelType, model),
      isEnabled: true,
    })
    await this.loadModelsToRegistry()
  }

  async updateModel(id: string, updates: Pick<ModelscopeCustomModelEntry, 'name' | 'modelType'>): Promise<void> {
    await this.ensureReady()
    const existing = await databaseService.getCustomModelById(id)
    const existingPricing = existing && isModelscopeCustomModelRecord(existing)
      ? toEntry(existing)
      : undefined
    await databaseService.updateCustomModel(id, {
      name: updates.name,
      config: createConfig(updates.modelType, existingPricing),
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
        config: createConfig(model.modelType, model),
        isEnabled: true,
      })
    }

    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
}

export const modelscopeCustomModelService = new ModelscopeCustomModelService()
