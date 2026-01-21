/**
 * 预设类型定义
 */

/**
 * 预设接口
 */
export interface Preset {
  /** 唯一标识 */
  id: string

  /** 预设名称 */
  name: string

  /** 预设描述（可选） */
  description: string | null

  /** 绑定的模型 ID（null = 全局预设） */
  modelId: string | null

  /** 参数对象 */
  params: PresetParams

  /** 是否收藏 */
  isFavorite: boolean

  /** 使用次数 */
  useCount: number

  /** 创建时间 */
  createdAt: string

  /** 更新时间 */
  updatedAt: string
}

/**
 * 预设参数类型
 */
export type PresetParams = Record<string, any>

/**
 * 创建预设输入
 */
export interface CreatePresetInput {
  name: string
  description?: string
  modelId?: string | null
  params: PresetParams
  isFavorite?: boolean
}

/**
 * 更新预设输入
 */
export interface UpdatePresetInput {
  name?: string
  description?: string
  params?: PresetParams
  isFavorite?: boolean
}

/**
 * 预设查询选项
 */
export interface PresetQueryOptions {
  /** 只查询指定模型的预设 */
  modelId?: string | null

  /** 只查询收藏的预设 */
  onlyFavorites?: boolean

  /** 限制返回数量 */
  limit?: number

  /** 偏移量 */
  offset?: number

  /** 搜索关键词（名称或描述） */
  search?: string
}
