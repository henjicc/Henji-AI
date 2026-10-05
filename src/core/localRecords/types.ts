/*
 * 程序目录数据库里的本地记录（生成记录、预设、设置）对外的数据形态（存储底座 2.3 数据库收口）。
 *
 * - 主进程各仓库是这些表的唯一读写入口，渲染层经类型化接口访问，不再执行 SQL。
 * - 记录里的文件位置在内存里一律是绝对路径；写入数据库时由主进程换成位置写法（实施方案 2.5），
 *   读出时换回。调用方不用、也不能自己做相对路径换算。
 * - 本文件是纯类型，主进程与渲染层共用，只用相对导入。
 */

export type GenerationHistoryMediaType = 'image' | 'video' | 'audio'

export type GenerationHistoryStatus =
  | 'queued'
  | 'pending'
  | 'generating'
  | 'success'
  | 'error'
  | 'timeout'
  | 'cancelled'
  // 旧版本数据库里的同义终态，读取时原样返回
  | 'completed'
  | 'failed'

export type LocalRecordParams = Record<string, unknown>

export interface GenerationHistoryRecordDto {
  id: string
  providerId: string
  modelId: string
  type: GenerationHistoryMediaType
  prompt: string | null
  params: LocalRecordParams
  /** 已保存到本地的结果文件（绝对路径），多个结果按输出顺序排列；没有本地结果为空数组。 */
  resultPaths: string[]
  taskId: string | null
  status: GenerationHistoryStatus
  errorMessage: string | null
  cost: number | null
  duration: number | null
  createdAt: string
  updatedAt: string
}

export interface GenerationHistoryInsertDto {
  id: string
  providerId: string
  modelId: string
  type: GenerationHistoryMediaType
  prompt: string | null
  params: LocalRecordParams
  resultPaths: string[]
  taskId: string | null
  status: GenerationHistoryStatus
  errorMessage: string | null
  cost: number | null
  duration: number | null
  /** 只在导入或测试夹具需要保留原时间时传入（ISO 字符串）；不传按当前时间。 */
  createdAt?: string
}

export type GenerationHistoryUpdateDto = Partial<Omit<GenerationHistoryInsertDto, 'id' | 'createdAt'>>

export interface GenerationHistoryQuery {
  providerId?: string
  modelId?: string
  type?: GenerationHistoryMediaType
  status?: GenerationHistoryStatus
  /** 按提示词全文检索（子串匹配，不分大小写）。 */
  search?: string
  /** 只列出 ID 以此开头的记录（测试夹具清理用）。 */
  idPrefix?: string
  limit?: number
  offset?: number
}

export interface PresetRecordDto {
  id: string
  name: string
  description: string | null
  /** null 表示全局预设。 */
  modelId: string | null
  params: LocalRecordParams
  isFavorite: boolean
  useCount: number
  createdAt: string
  updatedAt: string
}

export interface PresetInsertDto {
  id: string
  name: string
  description: string | null
  modelId: string | null
  params: LocalRecordParams
  isFavorite: boolean
}

export interface PresetUpdateDto {
  name?: string
  description?: string | null
  params?: LocalRecordParams
  isFavorite?: boolean
}

export interface PresetQuery {
  /** 传字符串：该模型的预设与全局预设；传 null：只要全局预设；不传：全部。 */
  modelId?: string | null
  onlyFavorites?: boolean
  limit?: number
  offset?: number
}

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json'

export interface SettingEntryDto {
  key: string
  value: string
  type: SettingValueType
}
