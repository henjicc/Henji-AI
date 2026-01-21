/**
 * 预设迁移工具
 *
 * 从 localStorage 迁移旧预设到 SQLite 数据库
 */

import { presetService } from './PresetService'

/**
 * 旧预设格式（localStorage）
 */
interface LegacyPreset {
  name: string
  description?: string
  modelId?: string
  settings?: Record<string, any>
  params?: Record<string, any>
}

/**
 * 迁移结果
 */
export interface PresetMigrationResult {
  success: boolean
  migratedCount: number
  errors: string[]
}

/**
 * 从 localStorage 迁移旧预设
 *
 * @returns 迁移结果
 */
export async function migratePresetsFromLocalStorage(): Promise<PresetMigrationResult> {
  const result: PresetMigrationResult = {
    success: false,
    migratedCount: 0,
    errors: []
  }

  try {
    // 检查 localStorage 中的旧预设
    const oldPresetsJson = localStorage.getItem('presets')
    if (!oldPresetsJson) {
      console.log('[PresetMigration] No presets found in localStorage')
      result.success = true
      return result
    }

    console.log('[PresetMigration] Found presets in localStorage, starting migration...')

    const oldPresets: LegacyPreset[] = JSON.parse(oldPresetsJson)

    for (const oldPreset of oldPresets) {
      try {
        // 转换格式
        await presetService.createPreset({
          name: oldPreset.name,
          description: oldPreset.description,
          modelId: oldPreset.modelId || null,
          params: oldPreset.settings || oldPreset.params || {},
          isFavorite: false
        })
        result.migratedCount++
      } catch (error: any) {
        result.errors.push(`Failed to migrate preset "${oldPreset.name}": ${error.message}`)
      }
    }

    // 备份并删除旧数据
    localStorage.setItem('presets_backup', oldPresetsJson)
    localStorage.removeItem('presets')

    result.success = true
    console.log(`[PresetMigration] Migrated ${result.migratedCount} presets from localStorage`)

    if (result.errors.length > 0) {
      console.warn('[PresetMigration] Errors during migration:', result.errors)
    }

    return result
  } catch (error: any) {
    console.error('[PresetMigration] Migration failed:', error)
    result.errors.push(error.message)
    return result
  }
}

/**
 * 检查是否需要迁移
 *
 * @returns 是否需要迁移
 */
export function needsPresetMigration(): boolean {
  return localStorage.getItem('presets') !== null
}
