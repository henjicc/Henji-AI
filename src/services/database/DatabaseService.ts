import {
  deleteCustomModel as deleteCustomModelCommand,
  getCustomModel as getCustomModelCommand,
  insertCustomModel as insertCustomModelCommand,
  listCustomModels,
  updateCustomModel as updateCustomModelCommand,
} from '@/commands/customModels'
import {
  clearGenerationHistory,
  deleteGenerationHistory,
  getGenerationHistory,
  insertGenerationHistory,
  listGenerationHistory,
  updateGenerationHistory,
} from '@/commands/generationHistory'
import {
  deletePreset as deletePresetCommand,
  getPreset,
  incrementPresetUsage as incrementPresetUsageCommand,
  insertPreset as insertPresetCommand,
  listPresets,
  updatePreset as updatePresetCommand,
} from '@/commands/presets'
import { deleteAppSetting, getAppSetting, setAppSetting } from '@/commands/appSettings'
import type {
  DatabaseService as IDatabaseService,
  HistoryRecord,
  PresetRecord,
  SettingRecord,
  CustomModelRecord,
  HistoryQueryOptions,
  PresetQueryOptions,
} from './types'

/**
 * 渲染层本地记录服务（存储底座 2.3 起只是命令的聚合）。
 *
 * 生成记录、预设、设置、自定义模型的表都归主进程仓库；这里不执行 SQL、不建表，
 * 只把渲染层的调用转给 `src/commands/` 的类型化接口。记录里的路径一律是绝对路径。
 */
export class DatabaseService implements IDatabaseService {
  // ==================== History Operations ====================

  async insertHistory(record: Omit<HistoryRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    // 接口按字段严格校验：只转交记录字段，调用方对象上多出的属性不进入请求。
    await insertGenerationHistory({
      id: record.id, providerId: record.providerId, modelId: record.modelId, type: record.type, prompt: record.prompt,
      params: record.params, resultPaths: record.resultPaths, taskId: record.taskId, status: record.status,
      errorMessage: record.errorMessage, cost: record.cost, duration: record.duration,
    })
  }

  async getHistory(options: HistoryQueryOptions = {}): Promise<HistoryRecord[]> {
    return (await listGenerationHistory(options)) as HistoryRecord[]
  }

  async getHistoryById(id: string): Promise<HistoryRecord | null> {
    return (await getGenerationHistory(id)) as HistoryRecord | null
  }

  async updateHistory(
    id: string,
    updates: Partial<Omit<HistoryRecord, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    const { providerId, modelId, type, prompt, params, resultPaths, taskId, status, errorMessage, cost, duration } = updates
    const picked = { providerId, modelId, type, prompt, params, resultPaths, taskId, status, errorMessage, cost, duration }
    // 只转交给出的字段（undefined 表示不改）。
    await updateGenerationHistory(id, Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined)))
  }

  async deleteHistory(id: string): Promise<void> {
    await deleteGenerationHistory(id)
  }

  async clearHistory(olderThan?: Date): Promise<number> {
    return await clearGenerationHistory(olderThan?.toISOString())
  }

  // ==================== Preset Operations ====================

  async insertPreset(preset: Omit<PresetRecord, 'createdAt' | 'updatedAt' | 'useCount'>): Promise<void> {
    await insertPresetCommand(preset)
  }

  async getPresets(options: PresetQueryOptions = {}): Promise<PresetRecord[]> {
    return (await listPresets(options)) as PresetRecord[]
  }

  async getPresetById(id: string): Promise<PresetRecord | null> {
    return (await getPreset(id)) as PresetRecord | null
  }

  async updatePreset(id: string, updates: Partial<PresetRecord>): Promise<void> {
    await updatePresetCommand(id, {
      name: updates.name,
      description: updates.description,
      params: updates.params,
      isFavorite: updates.isFavorite,
    })
  }

  async deletePreset(id: string): Promise<void> {
    await deletePresetCommand(id)
  }

  async incrementPresetUsage(id: string): Promise<void> {
    await incrementPresetUsageCommand(id)
  }

  // ==================== Settings Operations ====================

  async getSetting(key: string): Promise<string | null> {
    return await getAppSetting(key)
  }

  async setSetting(key: string, value: string, type: SettingRecord['type'] = 'string'): Promise<void> {
    await setAppSetting(key, value, type)
  }

  async deleteSetting(key: string): Promise<void> {
    await deleteAppSetting(key)
  }

  // ==================== Custom Model Operations ====================

  async insertCustomModel(model: Omit<CustomModelRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    await insertCustomModelCommand(model)
  }

  async getCustomModels(providerId?: string): Promise<CustomModelRecord[]> {
    return await listCustomModels(providerId)
  }

  async getCustomModelById(id: string): Promise<CustomModelRecord | null> {
    return await getCustomModelCommand(id)
  }

  async updateCustomModel(id: string, updates: Partial<CustomModelRecord>): Promise<void> {
    await updateCustomModelCommand(id, {
      name: updates.name,
      config: updates.config,
      isEnabled: updates.isEnabled,
    })
  }

  async deleteCustomModel(id: string): Promise<void> {
    await deleteCustomModelCommand(id)
  }
}

// Singleton instance
export const databaseService = new DatabaseService()
