import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { getModelDisplayName } from '@/utils/modelHelpers'
import {
  matchesGenerationHistoryFilter,
  toGenerationHistoryTimestamp,
  type GenerationHistoryFilterCriteria,
  type GenerationHistorySubject,
} from '@/features/generation/domain/generationHistoryFilter'
import type { GenerationHistoryFilterState } from '@/stores/generationHistoryFilterStore.ts'
import type { GenerationTask } from '../types'

type TaskFilterState = Pick<
  GenerationHistoryFilterState,
  'keyword' | 'providerId' | 'modelId' | 'mediaType' | 'timePreset' | 'startDate' | 'endDate'
>

export interface UseTaskFiltersResult {
  filteredTasks: GenerationTask[]
  matchedCount: number
  hasActiveFilters: boolean
}

function toSubject(task: GenerationTask, locale: string): GenerationHistorySubject {
  return {
    prompt: task.prompt ?? null,
    modelId: task.model,
    modelDisplayName: getModelDisplayName(task.model, locale),
    providerId: task.provider ?? null,
    errorText: task.error ?? null,
    mediaType: task.type,
    createdAt: toGenerationHistoryTimestamp(task.createdAt),
  }
}

/**
 * 界面筛选器用 `'all'` 表示不筛，谓词用 `undefined` 表示不筛——
 * 谓词要同时服务助手（那边没有 `'all'` 这个概念），所以在这里做一次归一。
 */
function toCriteria(filters: TaskFilterState): GenerationHistoryFilterCriteria {
  return {
    keyword: filters.keyword,
    providerId: filters.providerId === 'all' ? undefined : filters.providerId,
    modelId: filters.modelId === 'all' ? undefined : filters.modelId,
    mediaType: filters.mediaType === 'all' ? undefined : filters.mediaType,
    timePreset: filters.timePreset === 'all' ? undefined : filters.timePreset,
    startDate: filters.startDate,
    endDate: filters.endDate,
  }
}

export function useTaskFilters(tasks: GenerationTask[], filters: TaskFilterState): UseTaskFiltersResult {
  const { currentLanguage } = useI18n()
  const [modelNamesRevision, setModelNamesRevision] = useState(0)
  useEffect(() => {
    const refresh = (): void => setModelNamesRevision(value => value + 1)
    window.addEventListener('modelVisibilityChanged', refresh)
    return () => window.removeEventListener('modelVisibilityChanged', refresh)
  }, [])
  const keyword = filters.keyword.trim().toLowerCase()
  const { providerId, modelId, mediaType, timePreset, startDate, endDate } = filters
  const criteria = useMemo(() => toCriteria({ keyword, providerId, modelId, mediaType, timePreset, startDate, endDate }),
    [keyword, providerId, modelId, mediaType, timePreset, startDate, endDate])

  const filteredTasks = useMemo(() => {
    // 一次取当前时刻，供整批记录共用：逐条各取一次会让 7d 这类相对区间的边界在
    // 遍历过程中漂移，条数多时最早那几条与最后那几条的判定基准就不是同一个了。
    const now = Date.now()
    // 模型显示名称随语言变化；不能只缓存数据和条件而留下旧语言的搜索结果。
    return tasks.filter((task) => matchesGenerationHistoryFilter(toSubject(task, currentLanguage), criteria, now))
    // 别名存在 localStorage；既有广播使 getModelDisplayName 的外部数据失效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, criteria, currentLanguage, modelNamesRevision])

  const hasCustomDateRange = filters.timePreset === 'custom' && (filters.startDate.length > 0 || filters.endDate.length > 0)
  const hasActiveFilters =
    keyword.length > 0 ||
    filters.providerId !== 'all' ||
    filters.modelId !== 'all' ||
    filters.mediaType !== 'all' ||
    filters.timePreset !== 'all' ||
    hasCustomDateRange

  return {
    filteredTasks,
    matchedCount: filteredTasks.length,
    hasActiveFilters,
  }
}
