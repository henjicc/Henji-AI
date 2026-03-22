import { useMemo } from 'react'
import { getModelDisplayName } from '@/utils/modelHelpers'
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

function parseDateStart(dateText: string): number | null {
  if (!dateText) return null
  const parts = dateText.split('-').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function parseDateEnd(dateText: string): number | null {
  if (!dateText) return null
  const parts = dateText.split('-').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
}

function resolveTimeRange(filters: TaskFilterState): { start: number | null; end: number | null } {
  if (filters.timePreset === 'all') {
    return { start: null, end: null }
  }

  if (filters.timePreset === '7d' || filters.timePreset === '30d' || filters.timePreset === '90d') {
    const dayCount = filters.timePreset === '7d' ? 7 : filters.timePreset === '30d' ? 30 : 90
    const end = Date.now()
    return {
      start: end - dayCount * 24 * 60 * 60 * 1000,
      end,
    }
  }

  const start = parseDateStart(filters.startDate)
  const end = parseDateEnd(filters.endDate)
  if (start !== null && end !== null && start > end) {
    return { start: end, end: start }
  }
  return { start, end }
}

function getTaskCreatedAt(task: GenerationTask): number | null {
  const timestamp = task.createdAt instanceof Date
    ? task.createdAt.getTime()
    : new Date(task.createdAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function buildSearchText(task: GenerationTask): string {
  return [
    task.prompt,
    task.model,
    getModelDisplayName(task.model),
    task.provider ?? '',
    task.error ?? '',
  ].join(' ').toLowerCase()
}

export function useTaskFilters(tasks: GenerationTask[], filters: TaskFilterState): UseTaskFiltersResult {
  const keyword = filters.keyword.trim().toLowerCase()
  const { start, end } = useMemo(() => resolveTimeRange(filters), [
    filters.endDate,
    filters.startDate,
    filters.timePreset,
  ])

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filters.providerId !== 'all' && task.provider !== filters.providerId) {
        return false
      }

      if (filters.modelId !== 'all' && task.model !== filters.modelId) {
        return false
      }

      if (filters.mediaType !== 'all' && task.type !== filters.mediaType) {
        return false
      }

      if (keyword && !buildSearchText(task).includes(keyword)) {
        return false
      }

      if (start !== null || end !== null) {
        const taskCreatedAt = getTaskCreatedAt(task)
        if (taskCreatedAt === null) return false
        if (start !== null && taskCreatedAt < start) return false
        if (end !== null && taskCreatedAt > end) return false
      }

      return true
    })
  }, [tasks, filters.providerId, filters.modelId, filters.mediaType, keyword, start, end])

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
