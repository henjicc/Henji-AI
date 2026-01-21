/**
 * 预设管理服务
 */

import { databaseService } from '../database/DatabaseService'
import type {
  Preset,
  CreatePresetInput,
  UpdatePresetInput,
  PresetQueryOptions
} from '@/core/types/Preset'
import { nanoid } from 'nanoid'

/**
 * 预设管理服务类
 */
export class PresetService {
  /**
   * 创建预设
   */
  async createPreset(input: CreatePresetInput): Promise<Preset> {
    const preset: Omit<Preset, 'createdAt' | 'updatedAt'> = {
      id: nanoid(),
      name: input.name,
      description: input.description || null,
      modelId: input.modelId || null,
      params: input.params,
      isFavorite: input.isFavorite || false,
      useCount: 0
    }

    await databaseService.insertPreset(preset)

    // Return with timestamps
    const created = await this.getPresetById(preset.id)
    if (!created) {
      throw new Error('Failed to create preset')
    }

    return created
  }

  /**
   * 获取预设列表
   */
  async getPresets(options?: PresetQueryOptions): Promise<Preset[]> {
    return await databaseService.getPresets(options)
  }

  /**
   * 获取指定模型的预设（包括全局预设）
   */
  async getPresetsForModel(modelId: string): Promise<Preset[]> {
    // 获取模型专用预设
    const modelPresets = await databaseService.getPresets({ modelId })

    // 获取全局预设
    const globalPresets = await databaseService.getPresets({ modelId: null })

    // 合并并按收藏和使用次数排序
    return [...modelPresets, ...globalPresets].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1
      }
      return b.useCount - a.useCount
    })
  }

  /**
   * 获取单个预设
   */
  async getPresetById(id: string): Promise<Preset | null> {
    return await databaseService.getPresetById(id)
  }

  /**
   * 更新预设
   */
  async updatePreset(id: string, updates: UpdatePresetInput): Promise<void> {
    await databaseService.updatePreset(id, updates)
  }

  /**
   * 删除预设
   */
  async deletePreset(id: string): Promise<void> {
    await databaseService.deletePreset(id)
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(id: string): Promise<void> {
    const preset = await this.getPresetById(id)
    if (preset) {
      await this.updatePreset(id, { isFavorite: !preset.isFavorite })
    }
  }

  /**
   * 应用预设（增加使用次数）
   */
  async applyPreset(id: string): Promise<Preset | null> {
    await databaseService.incrementPresetUsage(id)
    return await this.getPresetById(id)
  }

  /**
   * 导出预设为 JSON
   */
  async exportPreset(id: string): Promise<string> {
    const preset = await this.getPresetById(id)
    if (!preset) {
      throw new Error('Preset not found')
    }

    return JSON.stringify({
      name: preset.name,
      description: preset.description,
      modelId: preset.modelId,
      params: preset.params,
      version: '1.0'
    }, null, 2)
  }

  /**
   * 从 JSON 导入预设
   */
  async importPreset(json: string): Promise<Preset> {
    const data = JSON.parse(json)

    // 验证格式
    if (!data.name || !data.params) {
      throw new Error('Invalid preset format')
    }

    return await this.createPreset({
      name: data.name,
      description: data.description,
      modelId: data.modelId,
      params: data.params
    })
  }

  /**
   * 清理未使用的预设
   */
  async cleanupUnused(minUseCount: number = 0, daysOld: number = 30): Promise<number> {
    const allPresets = await this.getPresets()
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - daysOld)

    let deletedCount = 0

    for (const preset of allPresets) {
      if (
        !preset.isFavorite &&
        preset.useCount <= minUseCount &&
        new Date(preset.createdAt) < threshold
      ) {
        await this.deletePreset(preset.id)
        deletedCount++
      }
    }

    return deletedCount
  }
}

// 单例导出
let presetServiceInstance: PresetService | null = null

export function getPresetService(): PresetService {
  if (!presetServiceInstance) {
    presetServiceInstance = new PresetService()
  }
  return presetServiceInstance
}

export const presetService = getPresetService()
