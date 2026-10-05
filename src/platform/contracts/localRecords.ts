import type {
  GenerationHistoryInsertDto,
  GenerationHistoryQuery,
  GenerationHistoryRecordDto,
  GenerationHistoryUpdateDto,
  PresetInsertDto,
  PresetQuery,
  PresetRecordDto,
  PresetUpdateDto,
  SettingEntryDto,
  SettingValueType,
} from '../../core/localRecords/types'

/*
 * 本地记录的平台接口（存储底座 2.3 数据库收口）：生成记录、预设、设置。
 * 表只归主进程仓库所有，渲染层不执行 SQL；主进程仓库与 preload 桥按同一接口实现，类型由编译器对齐。
 * 记录里的文件位置在接口两侧都是绝对路径，位置写法的换算只在主进程仓库里发生。
 */

export type * from '../../core/localRecords/types'

export interface GenerationHistoryPlatform {
  /** 按创建时间倒序列出。 */
  list(query?: GenerationHistoryQuery): Promise<GenerationHistoryRecordDto[]>
  get(id: string): Promise<GenerationHistoryRecordDto | null>
  count(): Promise<number>
  insert(record: GenerationHistoryInsertDto): Promise<void>
  /** 一个事务里写入多条（导入、测试夹具）；任一条失败整体不写。 */
  insertMany(records: GenerationHistoryInsertDto[]): Promise<void>
  update(id: string, updates: GenerationHistoryUpdateDto): Promise<void>
  delete(id: string): Promise<void>
  /** 返回实际删除的条数。 */
  deleteMany(ids: string[]): Promise<number>
  /** 不传时间时清空全部；返回删除条数。 */
  clear(olderThan?: string): Promise<number>
}

export interface PresetsPlatform {
  list(query?: PresetQuery): Promise<PresetRecordDto[]>
  get(id: string): Promise<PresetRecordDto | null>
  insert(preset: PresetInsertDto): Promise<void>
  update(id: string, updates: PresetUpdateDto): Promise<void>
  delete(id: string): Promise<void>
  incrementUsage(id: string): Promise<void>
}

export interface SettingsPlatform {
  get(key: string): Promise<SettingEntryDto | null>
  set(key: string, value: string, type?: SettingValueType): Promise<void>
  delete(key: string): Promise<void>
}

/** IPC 通道名与各平台接口方法一一对应（主进程注册与 preload 桥共用）。 */
export const GENERATION_HISTORY_IPC_CHANNELS = {
  list: 'generationHistory:list',
  get: 'generationHistory:get',
  count: 'generationHistory:count',
  insert: 'generationHistory:insert',
  insertMany: 'generationHistory:insertMany',
  update: 'generationHistory:update',
  delete: 'generationHistory:delete',
  deleteMany: 'generationHistory:deleteMany',
  clear: 'generationHistory:clear',
} as const satisfies Record<keyof GenerationHistoryPlatform, string>

export const PRESETS_IPC_CHANNELS = {
  list: 'presets:list',
  get: 'presets:get',
  insert: 'presets:insert',
  update: 'presets:update',
  delete: 'presets:delete',
  incrementUsage: 'presets:incrementUsage',
} as const satisfies Record<keyof PresetsPlatform, string>

export const SETTINGS_IPC_CHANNELS = {
  get: 'appSettings:get',
  set: 'appSettings:set',
  delete: 'appSettings:delete',
} as const satisfies Record<keyof SettingsPlatform, string>
