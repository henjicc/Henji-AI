import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type {
  GenerationHistoryMediaType,
  GenerationHistoryTimePreset,
} from '@/stores/generationHistoryFilterStore.ts'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton, UiInput } from './primitives'
import Dropdown from './Dropdown'
import { UiDatePicker } from './UiDatePicker'

export interface UiTaskHistoryModelOption {
  label: string
  value: string
}

export interface UiTaskHistoryFilterBarProps {
  mode?: 'collapsible' | 'always'
  showCloseButton?: boolean
  keyword: string
  providerId: string
  modelId: string
  mediaType: GenerationHistoryMediaType
  timePreset: GenerationHistoryTimePreset
  startDate: string
  endDate: string
  providerOptions: UiTaskHistoryModelOption[]
  modelOptions: UiTaskHistoryModelOption[]
  mediaOptions?: Array<{ label: string; value: GenerationHistoryMediaType }>
  onKeywordChange: (keyword: string) => void
  onProviderChange: (providerId: string) => void
  onModelChange: (modelId: string) => void
  onMediaTypeChange: (mediaType: GenerationHistoryMediaType) => void
  onTimePresetChange: (timePreset: GenerationHistoryTimePreset) => void
  onStartDateChange: (startDate: string) => void
  onEndDateChange: (endDate: string) => void
  onClose?: () => void
}

export function UiTaskHistoryFilterBar({
  mode = 'collapsible',
  showCloseButton = false,
  keyword,
  providerId,
  modelId,
  mediaType,
  timePreset,
  startDate,
  endDate,
  providerOptions,
  modelOptions,
  mediaOptions,
  onKeywordChange,
  onProviderChange,
  onModelChange,
  onMediaTypeChange,
  onTimePresetChange,
  onStartDateChange,
  onEndDateChange,
  onClose,
}: UiTaskHistoryFilterBarProps): JSX.Element {
  const { t, i18n } = useI18n('ui')
  const isAlwaysVisible = mode === 'always'
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const panelVisible = isAlwaysVisible || isExpanded
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const iconAnchorRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [triggerShiftX, setTriggerShiftX] = useState<number>(0)
  const timeOptions: Array<{ label: string; value: GenerationHistoryTimePreset }> = [
    { value: 'all', label: t('workspaceFilters.time.all') },
    { value: '7d', label: t('workspaceFilters.time.last7Days') },
    { value: '30d', label: t('workspaceFilters.time.last30Days') },
    { value: '90d', label: t('workspaceFilters.time.last90Days') },
    { value: 'custom', label: t('workspaceFilters.time.custom') },
  ]
  const defaultMediaOptions: Array<{ label: string; value: GenerationHistoryMediaType }> = [
    { value: 'all', label: t('workspaceToolbar.filter.all') },
    { value: 'image', label: t('workspaceToolbar.filter.image') },
    { value: 'video', label: t('workspaceToolbar.filter.video') },
    { value: 'audio', label: t('workspaceToolbar.filter.audio') },
  ]
  const resolvedMediaOptions = mediaOptions && mediaOptions.length > 0 ? mediaOptions : defaultMediaOptions
  const providerSelectOptions = providerOptions.length > 0
    ? providerOptions
    : [{ value: 'all', label: t('workspaceFilters.provider.all') }]
  const modelSelectOptions = modelOptions.length > 0
    ? modelOptions
    : [{ value: 'all', label: t('workspaceFilters.model.all') }]
  const selectedTimeLabel = timeOptions.find((option) => option.value === timePreset)?.label ?? t('workspaceFilters.time.all')
  const selectedMediaLabel = resolvedMediaOptions.find((option) => option.value === mediaType)?.label ?? t('workspaceToolbar.filter.all')
  const selectedProviderLabel = providerSelectOptions.find((option) => option.value === providerId)?.label ?? t('workspaceFilters.provider.all')
  const selectedModelLabel = modelSelectOptions.find((option) => option.value === modelId)?.label ?? t('workspaceFilters.model.all')
  const hasActiveFilters = useMemo(() => {
    const hasCustomDateRange = timePreset === 'custom' && (startDate.length > 0 || endDate.length > 0)
    return keyword.trim().length > 0 ||
      providerId !== 'all' ||
      modelId !== 'all' ||
      mediaType !== 'all' ||
      timePreset !== 'all' ||
      hasCustomDateRange
  }, [endDate, keyword, mediaType, modelId, providerId, startDate, timePreset])

  useEffect(() => {
    if (isAlwaysVisible || !isExpanded) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setIsExpanded(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [isAlwaysVisible, isExpanded])

  useEffect(() => {
    if (isAlwaysVisible || !isExpanded) return
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setIsExpanded(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [isAlwaysVisible, isExpanded])

  useEffect(() => {
    if (isAlwaysVisible || !isExpanded) return
    window.setTimeout(() => inputRef.current?.focus(), 120)
  }, [isAlwaysVisible, isExpanded])

  useEffect(() => {
    if (isAlwaysVisible) {
      setTriggerShiftX(0)
      return
    }
    const updateTriggerShift = (): void => {
      const trigger = triggerRef.current?.querySelector('button')
      const anchor = iconAnchorRef.current
      if (!trigger || !anchor) {
        setTriggerShiftX(0)
        return
      }
      const triggerRect = trigger.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      const triggerCenter = triggerRect.left + triggerRect.width / 2
      const anchorCenter = anchorRect.left + anchorRect.width / 2
      setTriggerShiftX(anchorCenter - triggerCenter)
    }

    if (!isExpanded) {
      setTriggerShiftX(0)
      return
    }

    const rafId = window.requestAnimationFrame(updateTriggerShift)
    window.addEventListener('resize', updateTriggerShift)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateTriggerShift)
    }
  }, [isAlwaysVisible, isExpanded, modelOptions.length, providerOptions.length, mediaOptions?.length, timePreset, keyword])

  const panelContainerClassName = isAlwaysVisible
    ? 'relative z-30'
    : `absolute right-0 top-0 z-30 origin-right will-change-transform transition-[opacity,transform] duration-300 ease-out ${
      panelVisible ? 'opacity-100 scale-x-100 translate-x-0' : 'pointer-events-none opacity-0 scale-x-[0.35] translate-x-2'
    }`

  return (
    <div className={`relative flex items-start ${isAlwaysVisible ? 'justify-center' : 'justify-end'}`}>
      {!isAlwaysVisible && (
        <div ref={triggerRef}>
          <UiIconButton
            type="button"
            active={hasActiveFilters}
            className={`!h-8 !w-8 transition-[transform,opacity] duration-300 ease-out ${
              isExpanded
                ? 'pointer-events-none opacity-0 [transition-delay:70ms]'
                : 'opacity-100 [transition-delay:0ms]'
            }`}
            style={{
              transform: isExpanded ? `translate3d(${triggerShiftX}px,0,0)` : 'translate3d(0,0,0)',
            }}
            onClick={() => setIsExpanded(true)}
            title={t('workspaceFilters.expandSearch')}
          >
            <Search className="h-3.5 w-3.5" />
          </UiIconButton>
        </div>
      )}

      <div
        ref={panelRef}
        className={panelContainerClassName}
      >
        <div className="relative flex flex-col items-end gap-1 rounded-lg border border-border-dark/80 bg-panel px-2 py-1.5">
          <div className="relative flex items-center justify-end gap-1">
            <div className="relative shrink-0">
              <span ref={iconAnchorRef} className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <UiInput
                ref={inputRef}
                value={keyword}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder={t('workspaceFilters.searchPlaceholder')}
                className="h-8 w-[300px] border-border-dark bg-surface-dark pl-7 pr-7 text-xs"
              />
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                className={`absolute right-0.5 top-1/2 !h-5 !w-5 -translate-y-1/2 hover:!border-transparent hover:!bg-transparent transition-opacity duration-150 ${
                  keyword.length > 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
                onClick={() => {
                  onKeywordChange('')
                  window.setTimeout(() => inputRef.current?.focus(), 0)
                }}
                title={t('workspaceFilters.clearSearch')}
              >
                <X className="h-3 w-3" />
              </UiIconButton>
            </div>

            <Dropdown
              value={timePreset}
              display={selectedTimeLabel}
              options={timeOptions}
              onSelect={onTimePresetChange}
              portal={false}
              className="shrink-0"
              buttonClassName="!h-8 !px-2"
              minWidthStrategy="display"
              panelWidthStrategy="options"
              panelClassName="bg-panel border-border-dark"
            />

            <Dropdown
              value={mediaType}
              display={selectedMediaLabel}
              options={resolvedMediaOptions}
              onSelect={onMediaTypeChange}
              portal={false}
              className="shrink-0"
              buttonClassName="!h-8 !px-2"
              minWidthStrategy="display"
              panelWidthStrategy="options"
              panelClassName="bg-panel border-border-dark"
            />

            <Dropdown
              value={providerId}
              display={selectedProviderLabel}
              options={providerSelectOptions}
              onSelect={onProviderChange}
              portal={false}
              className="shrink-0"
              buttonClassName="!h-8 !px-2"
              minWidthStrategy="display"
              panelWidthStrategy="options"
              panelClassName="bg-panel border-border-dark"
            />

            <Dropdown
              value={modelId}
              display={selectedModelLabel}
              options={modelSelectOptions}
              onSelect={onModelChange}
              portal={false}
              className="shrink-0"
              buttonClassName="!h-8 !px-2"
              minWidthStrategy="display"
              panelWidthStrategy="options"
              panelClassName="bg-panel border-border-dark"
            />

            {showCloseButton && onClose && (
              <UiIconButton
                type="button"
                className="!h-8 !w-8"
                onClick={onClose}
                title={t('workspaceFilters.close')}
              >
                <X className="h-3.5 w-3.5" />
              </UiIconButton>
            )}
          </div>

          {timePreset === 'custom' && (
            <div className="flex items-center gap-1 text-xs text-text-muted">
              <UiDatePicker
                value={startDate}
                onChange={onStartDateChange}
                locale={i18n.language}
                placeholder={t('workspaceFilters.time.datePlaceholder')}
                ariaLabel={t('workspaceFilters.time.startDate')}
                clearLabel={t('workspaceFilters.time.clear')}
                todayLabel={t('workspaceFilters.time.today')}
                className="w-[120px]"
              />
              <span>-</span>
              <UiDatePicker
                value={endDate}
                onChange={onEndDateChange}
                locale={i18n.language}
                placeholder={t('workspaceFilters.time.datePlaceholder')}
                ariaLabel={t('workspaceFilters.time.endDate')}
                clearLabel={t('workspaceFilters.time.clear')}
                todayLabel={t('workspaceFilters.time.today')}
                className="w-[120px]"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
