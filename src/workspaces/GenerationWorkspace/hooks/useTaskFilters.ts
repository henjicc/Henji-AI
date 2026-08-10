import { useMemo } from 'react'
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

function toSubject(task: GenerationTask): GenerationHistorySubject {
  return {
    prompt: task.prompt ?? null,
    modelId: task.model,
    modelDisplayName: getModelDisplayName(task.model),
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
  const keyword = filters.keyword.trim().toLowerCase()

  const filteredTasks = useMemo(() => {
    const criteria = toCriteria(filters)
    // 一次取当前时刻，供整批记录共用：逐条各取一次会让 7d 这类相对区间的边界在
    // 遍历过程中漂移，条数多时最早那几条与最后那几条的判定基准就不是同一个了。
    const now = Date.now()
    return tasks.filter((task) => matchesGenerationHistoryFilter(toSubject(task), criteria, now))
  }, [tasks, filters])

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
