import { useCallback, useEffect, useMemo } from 'react'

import { useI18n } from '@/hooks/useI18n'
import {
  useGenerationHistoryFilterStore,
  type GenerationHistoryMediaType,
} from '@/stores/generationHistoryFilterStore'
import { getModelInfo, getProviderDisplayName } from '@/utils/modelHelpers'

import type { GenerationTask } from '../types'
import { useTaskFilters } from './useTaskFilters'

export function useGenerationHistoryFiltering(tasks: GenerationTask[]) {
  const { t } = useI18n()
  const {
    keyword: filterKeyword,
    providerId: filterProviderId,
    modelId: filterModelId,
    mediaType: filterMediaType,
    timePreset: filterTimePreset,
    startDate: filterStartDate,
    endDate: filterEndDate,
    setKeyword: setFilterKeyword,
    setProviderId: setFilterProviderId,
    setModelId: setFilterModelId,
    setMediaType: setFilterMediaType,
    setTimePreset: setFilterTimePreset,
    setStartDate: setFilterStartDate,
    setEndDate: setFilterEndDate,
    resetFilters: resetHistoryFilters,
  } = useGenerationHistoryFilterStore()
  const { filteredTasks, matchedCount, hasActiveFilters } = useTaskFilters(tasks, {
    keyword: filterKeyword,
    providerId: filterProviderId,
    modelId: filterModelId,
    mediaType: filterMediaType,
    timePreset: filterTimePreset,
    startDate: filterStartDate,
    endDate: filterEndDate,
  })

  const historyProviderOptions = useMemo(() => {
    const providers = new Map<string, string>()
    tasks.forEach((task) => {
      if (!task.provider || providers.has(task.provider)) return
      providers.set(task.provider, getProviderDisplayName(task.provider))
    })
    return Array.from(providers.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base', numeric: true }))
      .map(([value, label]) => ({ value, label }))
  }, [tasks])

  const historyModelOptions = useMemo(() => {
    const models = new Map<string, { label: string; providerId: string }>()
    tasks.forEach((task) => {
      if (!task.provider || models.has(task.model)) return
      models.set(task.model, {
        label: getModelInfo(task.model)?.name ?? task.model,
        providerId: task.provider,
      })
    })
    return Array.from(models.entries())
      .sort((a, b) => a[1].label.localeCompare(b[1].label, undefined, { sensitivity: 'base', numeric: true }))
      .map(([value, payload]) => ({ value, label: payload.label, providerId: payload.providerId }))
  }, [tasks])

  const historyMediaTypeOptions = useMemo<GenerationHistoryMediaType[]>(() => {
    const order: GenerationHistoryMediaType[] = ['image', 'video', 'audio']
    const available = new Set<GenerationHistoryMediaType>()
    tasks.forEach((task) => {
      if (task.type === 'image' || task.type === 'video' || task.type === 'audio') available.add(task.type)
    })
    return order.filter((type) => available.has(type))
  }, [tasks])

  const mediaFilterOptions = useMemo<Array<{ label: string; value: GenerationHistoryMediaType }>>(() => {
    const labelByType: Record<Exclude<GenerationHistoryMediaType, 'all'>, string> = {
      image: t('ui:workspaceToolbar.filter.image'),
      video: t('ui:workspaceToolbar.filter.video'),
      audio: t('ui:workspaceToolbar.filter.audio'),
    }
    return [
      { value: 'all', label: t('ui:workspaceToolbar.filter.all') },
      ...historyMediaTypeOptions.map((value) => ({
        value,
        label: labelByType[value as Exclude<GenerationHistoryMediaType, 'all'>],
      })),
    ]
  }, [historyMediaTypeOptions, t])
  const providerFilterOptions = useMemo(() => [
    { value: 'all', label: t('ui:workspaceFilters.provider.all') },
    ...historyProviderOptions,
  ], [historyProviderOptions, t])
  const modelFilterOptions = useMemo(() => [
    { value: 'all', label: t('ui:workspaceFilters.model.all') },
    ...(filterProviderId === 'all'
      ? historyModelOptions.map((option) => ({ value: option.value, label: option.label }))
      : historyModelOptions
        .filter((option) => option.providerId === filterProviderId)
        .map((option) => ({ value: option.value, label: option.label }))),
  ], [filterProviderId, historyModelOptions, t])

  const handleProviderFilterChange = useCallback((providerId: string): void => {
    setFilterProviderId(providerId)
    if (filterModelId === 'all' || providerId === 'all') return
    const modelVisible = historyModelOptions.some((option) => (
      option.value === filterModelId && option.providerId === providerId
    ))
    if (!modelVisible) setFilterModelId('all')
  }, [filterModelId, historyModelOptions, setFilterModelId, setFilterProviderId])

  useEffect(() => {
    if (filterProviderId !== 'all' && !historyProviderOptions.some((option) => option.value === filterProviderId)) {
      setFilterProviderId('all')
    }
  }, [filterProviderId, historyProviderOptions, setFilterProviderId])
  useEffect(() => {
    if (filterModelId === 'all') return
    const modelVisible = historyModelOptions.some((option) => (
      option.value === filterModelId
      && (filterProviderId === 'all' || option.providerId === filterProviderId)
    ))
    if (!modelVisible) setFilterModelId('all')
  }, [filterModelId, filterProviderId, historyModelOptions, setFilterModelId])
  useEffect(() => {
    if (filterMediaType !== 'all' && !historyMediaTypeOptions.includes(filterMediaType)) {
      setFilterMediaType('all')
    }
  }, [filterMediaType, historyMediaTypeOptions, setFilterMediaType])

  return {
    filterKeyword,
    filterProviderId,
    filterModelId,
    filterMediaType,
    filterTimePreset,
    filterStartDate,
    filterEndDate,
    setFilterKeyword,
    setFilterModelId,
    setFilterMediaType,
    setFilterTimePreset,
    setFilterStartDate,
    setFilterEndDate,
    resetHistoryFilters,
    filteredTasks,
    matchedCount,
    hasActiveFilters,
    providerFilterOptions,
    modelFilterOptions,
    mediaFilterOptions,
    handleProviderFilterChange,
  }
}
