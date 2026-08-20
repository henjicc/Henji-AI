import type { ModelType } from './types/ModelDefinition'

/** 生成 tab 模型面板的 provider 宏观分组顺序 */
export const PROVIDER_ORDER: Record<string, number> = {
  ppio: 0,
  kie: 1,
  apimart: 2,
  bailian: 3,
  volcengine: 4,
  modelscope: 5,
  fal: 6
}

/** 生成 tab 模型面板的类型宏观分组顺序 */
export const MODEL_TYPE_ORDER: Record<ModelType, number> = {
  image: 0,
  video: 1,
  audio: 2
}

export interface SeriesSortable {
  id: string
  name: string
  seriesId?: string
  seriesRank?: number
}

/**
 * 同系列模型按版本号降序排列，系列之间按系列 key 字母序排列。
 * 未声明 seriesId 的模型各自用自身 id 当分组 key，等价于按名称字母序单独排列。
 */
export function compareModelsBySeries(a: SeriesSortable, b: SeriesSortable): number {
  const familyA = a.seriesId ?? a.id
  const familyB = b.seriesId ?? b.id
  if (familyA !== familyB) {
    return familyA.localeCompare(familyB, 'en', { sensitivity: 'base' })
  }
  const rankDiff = (b.seriesRank ?? 0) - (a.seriesRank ?? 0)
  if (rankDiff !== 0) return rankDiff
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}
