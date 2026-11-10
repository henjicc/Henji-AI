import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type {
  GenerationHistoryMediaType,
  GenerationHistoryTimePreset,
} from '@/stores/generationHistoryFilterStore.ts'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton, UiSearchInput } from './primitives'
import Dropdown from './Dropdown'
import { UiDatePicker } from './UiDatePicker'
import { UI_TEXT_META_CLASS } from './styleTokens'

interface UiTaskHistoryModelOption {
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
  /** 是否显示媒体类型下拉；宿主已有类型选项卡时传 false，避免同一筛选出现两处入口。 */
  showMediaType?: boolean
  onKeywordChange: (keyword: string) => void
  onProviderChange: (providerId: string) => void
  onModelChange: (modelId: string) => void
  onMediaTypeChange: (mediaType: GenerationHistoryMediaType) => void
  onTimePresetChange: (timePreset: GenerationHistoryTimePreset) => void
  onStartDateChange: (startDate: string) => void
  onEndDateChange: (endDate: string) => void
  onClose?: () => void
}

interface UiTaskHistoryDateRangeProps {
  startDate: string
  endDate: string
  onStartDateChange: (startDate: string) => void
  onEndDateChange: (endDate: string) => void
}

/** 筛选选了“自定义时间”时的起止日期。 */
export function UiTaskHistoryDateRange({ startDate, endDate, onStartDateChange, onEndDateChange }: UiTaskHistoryDateRangeProps): JSX.Element {
  const { t, i18n } = useI18n('ui')
  const picker = (value: string, onChange: (value: string) => void, ariaLabel: string): JSX.Element => (
    <UiDatePicker
      value={value}
      onChange={onChange}
      locale={i18n.language}
      placeholder={t('workspaceFilters.time.datePlaceholder')}
      ariaLabel={ariaLabel}
      clearLabel={t('workspaceFilters.time.clear')}
      todayLabel={t('workspaceFilters.time.today')}
      className="w-[120px]"
    />
  )
  return (
    <div className={`flex items-center gap-1 ${UI_TEXT_META_CLASS}`}>
      {picker(startDate, onStartDateChange, t('workspaceFilters.time.startDate'))}
      <span>-</span>
      {picker(endDate, onEndDateChange, t('workspaceFilters.time.endDate'))}
    </div>
  )
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
  showMediaType = true,
  onKeywordChange,
  onProviderChange,
  onModelChange,
  onMediaTypeChange,
  onTimePresetChange,
  onStartDateChange,
  onEndDateChange,
  onClose,
}: UiTaskHistoryFilterBarProps): JSX.Element {
  const { t } = useI18n('ui')
  const isAlwaysVisible = mode === 'always'
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const panelVisible = isAlwaysVisible || isExpanded
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const iconAnchorRef = useRef<SVGSVGElement | null>(null)
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

  // 常驻模式随宿主展开而挂载：淡入，不从无到有地跳出来
  const panelContainerClassName = isAlwaysVisible
    ? 'relative min-w-0 animate-fade-in'
    : `absolute right-0 top-0 z-dropdown origin-right will-change-transform transition-[opacity,transform] duration-240 ease-out ${
      panelVisible ? 'opacity-100 scale-x-100 translate-x-0' : 'pointer-events-none opacity-0 scale-x-[0.35] translate-x-2'
    }`

  // 常驻模式与命令带同一行：窄了下拉先截断（点开能看到全称），不撑破这一行
  const dropdownLayout = isAlwaysVisible
    ? { className: 'min-w-16 max-w-32 shrink', buttonClassName: 'w-auto max-w-full', minWidthStrategy: 'none' as const }
    : { className: 'shrink-0', buttonClassName: 'w-auto', minWidthStrategy: 'display' as const }

  // 折叠面板里起止日期放在筛选下方；常驻模式由宿主放进从属带（命令带一行放不下）
  const customDateRange = !isAlwaysVisible && timePreset === 'custom' ? (
    <UiTaskHistoryDateRange startDate={startDate} endDate={endDate} onStartDateChange={onStartDateChange} onEndDateChange={onEndDateChange} />
  ) : null

  return (
    <div className={`relative flex ${isAlwaysVisible ? 'min-w-0 items-center justify-start' : 'items-start justify-end'}`}>
      {!isAlwaysVisible && (
        <div ref={triggerRef}>
          <UiIconButton size="md"
            type="button"
            on={hasActiveFilters}
            className={`transition-[transform,opacity] duration-240 ease-out ${
              isExpanded
                ? 'pointer-events-none opacity-0 [transition-delay:70ms]'
                : 'opacity-100 [transition-delay:0ms]'
            }`}
            style={{
              transform: isExpanded ? `translate3d(${triggerShiftX}px,0,0)` : 'translate3d(0,0,0)',
            }}
            onClick={() => setIsExpanded(true)}
            tooltip={t('workspaceFilters.expandSearch')}
          >
            <Search  />
          </UiIconButton>
        </div>
      )}

      <div
        ref={panelRef}
        className={panelContainerClassName}
      >
        {/* 常驻模式嵌在宿主命令带的同一行里：不自带底色与边框、不折行，搜索框先收窄；折叠模式是浮起的筛选面板 */}
        <div className={isAlwaysVisible
          ? 'relative flex min-w-0 items-center'
          : 'relative flex flex-col items-end gap-1 rounded-lg border border-line-strong bg-panel px-2 py-1.5'}
        >
          <div className={`relative flex items-center gap-1 ${isAlwaysVisible ? 'min-w-0 flex-nowrap justify-start' : 'flex-wrap justify-end'}`}>
            <UiSearchInput
              ref={inputRef}
              iconRef={iconAnchorRef}
              className={isAlwaysVisible ? 'w-60 min-w-24 shrink' : 'w-72 shrink-0'}
              value={keyword}
              onChange={(event) => onKeywordChange(event.target.value)}
              placeholder={t('workspaceFilters.searchPlaceholder')}
              aria-label={t('workspaceFilters.searchPlaceholder')}
              clearLabel={t('workspaceFilters.clearSearch')}
              onClear={() => {
                onKeywordChange('')
                window.setTimeout(() => inputRef.current?.focus(), 0)
              }}
            />

            <Dropdown
              value={timePreset}
              display={selectedTimeLabel}
              options={timeOptions}
              onSelect={onTimePresetChange}
              portal={isAlwaysVisible}
              {...dropdownLayout}
              panelWidthStrategy="options"
            />

            {showMediaType && (
              <Dropdown
                value={mediaType}
                display={selectedMediaLabel}
                options={resolvedMediaOptions}
                onSelect={onMediaTypeChange}
                portal={isAlwaysVisible}
                {...dropdownLayout}
                panelWidthStrategy="options"
              />
            )}

            <Dropdown
              value={providerId}
              display={selectedProviderLabel}
              options={providerSelectOptions}
              onSelect={onProviderChange}
              portal={isAlwaysVisible}
              {...dropdownLayout}
              panelWidthStrategy="options"
            />

            <Dropdown
              value={modelId}
              display={selectedModelLabel}
              options={modelSelectOptions}
              onSelect={onModelChange}
              portal={isAlwaysVisible}
              {...dropdownLayout}
              panelWidthStrategy="options"
            />

            {showCloseButton && onClose && (
              <UiIconButton size="md"
                type="button"
                onClick={onClose}
                tooltip={t('workspaceFilters.close')}
              >
                <X  />
              </UiIconButton>
            )}
          </div>

          {customDateRange}
        </div>
      </div>
    </div>
  )
}
