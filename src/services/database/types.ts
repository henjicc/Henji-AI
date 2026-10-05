/**
 * 渲染层本地记录类型（生成记录、预设、设置、自定义模型）。
 *
 * 表都归主进程仓库所有（存储底座 2.3），渲染层经 `src/commands/` 访问，不执行 SQL；
 * 数据形态来自共享的 `src/core/localRecords/types.ts`，这里只把参数收窄为渲染层的动态值类型。
 */

import type {
  GenerationHistoryMediaType,
  GenerationHistoryQuery,
  GenerationHistoryRecordDto,
  GenerationHistoryStatus,
  PresetQuery,
  PresetRecordDto,
  SettingValueType,
} from '@/core/localRecords/types'

// ==================== 历史记录类型 ====================

export type HistoryStatus = GenerationHistoryStatus

export interface HistoryRecord extends Omit<GenerationHistoryRecordDto, 'params'> {
  params: DynamicValueMap
}

// ==================== 预设类型 ====================

export interface PresetRecord extends Omit<PresetRecordDto, 'params'> {
  params: DynamicValueMap
}

// ==================== 设置类型 ====================

export interface SettingRecord {
  key: string
  value: string
  type: SettingValueType
}

// ==================== 自定义模型类型 ====================

export interface CustomModelRecord {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: DynamicValueMap
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

// ==================== 查询选项 ====================

export type HistoryQueryOptions = GenerationHistoryQuery
export type PresetQueryOptions = PresetQuery
export type HistoryMediaType = GenerationHistoryMediaType

// ==================== 数据库服务接口 ====================

export interface DatabaseService {
  // 历史记录
  insertHistory(record: Omit<HistoryRecord, 'createdAt' | 'updatedAt'>): Promise<void>
  getHistory(options?: HistoryQueryOptions): Promise<HistoryRecord[]>
  getHistoryById(id: string): Promise<HistoryRecord | null>
  updateHistory(id: string, updates: Partial<Omit<HistoryRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>
  deleteHistory(id: string): Promise<void>
  clearHistory(olderThan?: Date): Promise<number>  // 返回删除数量

  // 预设
  insertPreset(preset: Omit<PresetRecord, 'createdAt' | 'updatedAt' | 'useCount'>): Promise<void>
  getPresets(options?: PresetQueryOptions): Promise<PresetRecord[]>
  getPresetById(id: string): Promise<PresetRecord | null>
  updatePreset(id: string, updates: Partial<PresetRecord>): Promise<void>
  deletePreset(id: string): Promise<void>
  incrementPresetUsage(id: string): Promise<void>

  // 设置
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string, type?: SettingRecord['type']): Promise<void>
  deleteSetting(key: string): Promise<void>

  // 自定义模型
  insertCustomModel(model: Omit<CustomModelRecord, 'createdAt' | 'updatedAt'>): Promise<void>
  getCustomModels(providerId?: string): Promise<CustomModelRecord[]>
  getCustomModelById(id: string): Promise<CustomModelRecord | null>
  updateCustomModel(id: string, updates: Partial<CustomModelRecord>): Promise<void>
  deleteCustomModel(id: string): Promise<void>
}
