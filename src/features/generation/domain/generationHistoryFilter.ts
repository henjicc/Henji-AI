/*
 * 生成历史的筛选谓词，界面与助手共用同一份。
 *
 * 此前筛选逻辑只存在于 `useTaskFilters` 的 `useMemo` 里，而 `list_generation_history` 的
 * inputSchema 只有 mediaType / status / limit——界面上的关键词、供应商、模型、时间范围
 * 六个维度助手完全查不到。补的时候若在能力侧另写一份谓词，两套语义早晚漂移（关键词搜的
 * 字段范围、时间预设的边界、自定义区间起止颠倒时怎么办），用户会遇到"我筛出来 3 条、
 * 助手说只有 1 条"这种谁都说不清的问题。
 *
 * 所以谓词提到这里，两边都调它。纯函数，不 import React，`now` 由调用方传入以便测试。
 */

export type GenerationHistoryMediaFilter = 'image' | 'video' | 'audio'
export type GenerationHistoryTimePreset = '7d' | '30d' | '90d' | 'custom'

export interface GenerationHistoryFilterCriteria {
  /** 大小写不敏感的子串匹配，搜索范围见 buildGenerationHistorySearchText */
  keyword?: string
  providerId?: string
  modelId?: string
  mediaType?: GenerationHistoryMediaFilter
  timePreset?: GenerationHistoryTimePreset
  /** `YYYY-MM-DD`，仅 timePreset === 'custom' 时生效 */
  startDate?: string
  endDate?: string
}

/** 界面的 GenerationTask 与数据库历史记录都归一成这个形状再进谓词。 */
export interface GenerationHistorySubject {
  prompt: string | null
  modelId: string
  modelDisplayName: string
  providerId: string | null
  errorText: string | null
  mediaType: string
  createdAt: number | null
}

export interface GenerationHistoryTimeRange {
  start: number | null
  end: number | null
}

export function toGenerationHistoryTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : null
  }
  return null
}

function parseDayStart(dateText: string): number | null {
  if (!dateText) return null
  const parts = dateText.split('-').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function parseDayEnd(dateText: string): number | null {
  if (!dateText) return null
  const parts = dateText.split('-').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
}

const PRESET_DAYS: Record<Exclude<GenerationHistoryTimePreset, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export function resolveGenerationHistoryTimeRange(
  criteria: GenerationHistoryFilterCriteria,
  now: number,
): GenerationHistoryTimeRange {
  const preset = criteria.timePreset
  if (!preset) return { start: null, end: null }
  if (preset !== 'custom') {
    return { start: now - PRESET_DAYS[preset] * 24 * 60 * 60 * 1000, end: now }
  }
  const start = parseDayStart(criteria.startDate ?? '')
  const end = parseDayEnd(criteria.endDate ?? '')
  // 起止填反了按用户本意理解，而不是返回空结果让人以为没有记录。
  if (start !== null && end !== null && start > end) return { start: end, end: start }
  return { start, end }
}

export function buildGenerationHistorySearchText(subject: GenerationHistorySubject): string {
  return [
    subject.prompt ?? '',
    subject.modelId,
    subject.modelDisplayName,
    subject.providerId ?? '',
    subject.errorText ?? '',
  ].join(' ').toLowerCase()
}

export function matchesGenerationHistoryFilter(
  subject: GenerationHistorySubject,
  criteria: GenerationHistoryFilterCriteria,
  now: number,
): boolean {
  if (criteria.providerId && subject.providerId !== criteria.providerId) return false
  if (criteria.modelId && subject.modelId !== criteria.modelId) return false
  if (criteria.mediaType && subject.mediaType !== criteria.mediaType) return false

  const keyword = (criteria.keyword ?? '').trim().toLowerCase()
  if (keyword && !buildGenerationHistorySearchText(subject).includes(keyword)) return false

  const { start, end } = resolveGenerationHistoryTimeRange(criteria, now)
  if (start !== null || end !== null) {
    // 时间戳读不出来的记录在有时间条件时一律排除——界面就是这么做的，
    // 让"筛不出来"至少是一致的，而不是两边各给一个答案。
    if (subject.createdAt === null) return false
    if (start !== null && subject.createdAt < start) return false
    if (end !== null && subject.createdAt > end) return false
  }
  return true
}
