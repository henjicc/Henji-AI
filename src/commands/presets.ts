import { getPlatform } from '@/platform'
import type { PresetInsertDto, PresetQuery, PresetRecordDto, PresetUpdateDto } from '@/platform/contracts/localRecords'

/** 预设命令（存储底座 2.3）：表归主进程仓库，渲染层只经这里访问。 */

export async function listPresets(query?: PresetQuery): Promise<PresetRecordDto[]> {
  return await getPlatform().presets.list(query)
}

export async function getPreset(id: string): Promise<PresetRecordDto | null> {
  return await getPlatform().presets.get(id)
}

export async function insertPreset(preset: PresetInsertDto): Promise<void> {
  await getPlatform().presets.insert(preset)
}

export async function updatePreset(id: string, updates: PresetUpdateDto): Promise<void> {
  await getPlatform().presets.update(id, updates)
}

export async function deletePreset(id: string): Promise<void> {
  await getPlatform().presets.delete(id)
}

export async function incrementPresetUsage(id: string): Promise<void> {
  await getPlatform().presets.incrementUsage(id)
}
