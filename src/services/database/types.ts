/**
 * Database Type Definitions
 *
 * TypeScript interfaces for SQLite database tables
 */

// ==================== 历史记录类型 ====================

export type HistoryStatus =
  | 'queued'
  | 'pending'
  | 'generating'
  | 'success'
  | 'error'
  | 'timeout'
  // 兼容旧版本数据库字段值
  | 'completed'
  | 'failed'

export interface HistoryRecord {
  id: string
  providerId: string
  modelId: string
  type: 'image' | 'video' | 'audio'
  prompt: string | null
  params: DynamicValueMap
  filePath: string | null
  taskId: string | null
  status: HistoryStatus
  errorMessage: string | null
  cost: number | null
  duration: number | null
  createdAt: string
  updatedAt: string
}

// ==================== 预设类型 ====================

export interface PresetRecord {
  id: string
  name: string
  description: string | null
  modelId: string | null  // null = 全局预设
  params: DynamicValueMap
  isFavorite: boolean
  useCount: number
  createdAt: string
  updatedAt: string
}

// ==================== 设置类型 ====================

export interface SettingRecord {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'json'
  description: string | null
  updatedAt: string
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

export interface HistoryQueryOptions {
  providerId?: string
  modelId?: string
  type?: 'image' | 'video' | 'audio'
  status?: HistoryStatus
  limit?: number
  offset?: number
  searchPrompt?: string
}

export interface PresetQueryOptions {
  modelId?: string | null
  onlyFavorites?: boolean
  limit?: number
  offset?: number
}

// ==================== 数据库服务接口 ====================

export interface DatabaseService {
  // 初始化
  init(): Promise<void>

  // 历史记录
  insertHistory(record: Omit<HistoryRecord, 'createdAt' | 'updatedAt'>): Promise<void>
  getHistory(options?: HistoryQueryOptions): Promise<HistoryRecord[]>
  getHistoryById(id: string): Promise<HistoryRecord | null>
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

  // 工具方法
  vacuum(): Promise<void>  // 数据库优化
  backup(): Promise<string>  // 备份数据库，返回备份文件路径
}
