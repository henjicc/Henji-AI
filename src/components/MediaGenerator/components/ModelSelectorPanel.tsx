import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FILTERABLE_TAGS } from '@/core/types/ModelTags'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'
import {
  UiChipButton,
  UiIconButton,
  UiInput,
  UiMarqueeText,
  UiOptionButton,
  UI_CARD_ACTIVE_STRONG_CLASS,
  UI_CHIP_ACTIVE_STRONG_CLASS,
  UI_HIGHLIGHT_RING_INSET_CLASS
} from '@/components/ui'
import PinyinMatch from 'pinyin-match'
import { PROVIDER_ORDER, MODEL_TYPE_ORDER, compareModelsBySeries } from '@/core/modelSortOrder'
interface ModelSelectorPanelProps {
  selectedProvider: string
  selectedModel: string
  modelFilterProvider: string
  modelFilterType: 'all' | 'favorite' | 'image' | 'video' | 'audio'
  modelFilterFunction: string
  favoriteModels: Set<string>
  onModelSelect: (providerId: string, modelId: string) => void
  onFilterProviderChange: (provider: string) => void
  onFilterTypeChange: (type: 'all' | 'favorite' | 'image' | 'video' | 'audio') => void
  onFilterFunctionChange: (func: string) => void
  onToggleFavorite: (e: React.MouseEvent, providerId: string, modelId: string) => void
}
/**
 * 计算搜索匹配分数
 * @param modelName 模型名称
 * @param query 搜索查询
 * @returns 匹配分数 (0 = 不匹配, 100 = 完全匹配)
 */
function calculateMatchScore(modelName: string, query: string): number {
  if (!query) return 100 // 空查询匹配所有
  const lowerName = modelName.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerName === lowerQuery) return 100
  if (lowerName.startsWith(lowerQuery)) return 80
  if (lowerName.includes(lowerQuery)) return 60
  const pinyinResult = PinyinMatch.match(modelName, query)
  if (pinyinResult) return 40
  return 0
}
const GRID_COLUMNS = {
  default: 2,
  sm: 3,
  lg: 4,
  xl: 5
}
const MODEL_CARD_COLUMN_GAP_CLASS = 'gap-x-2'
const MODEL_CARD_ROW_GAP_CLASS = 'gap-y-1.5'
const MODEL_CARD_META_TEXT_CLASS = 'text-2xs leading-4 text-zinc-400'

function compareModelItems(
  a: { p: { id: string; name: string }; m: { id: string; type: 'image' | 'video' | 'audio'; name: string; seriesId?: string; seriesRank?: number } },
  b: { p: { id: string; name: string }; m: { id: string; type: 'image' | 'video' | 'audio'; name: string; seriesId?: string; seriesRank?: number } }
): number {
  const providerDiff = (PROVIDER_ORDER[a.p.id] ?? Number.MAX_SAFE_INTEGER) - (PROVIDER_ORDER[b.p.id] ?? Number.MAX_SAFE_INTEGER)
  if (providerDiff !== 0) return providerDiff

  const typeDiff = MODEL_TYPE_ORDER[a.m.type] - MODEL_TYPE_ORDER[b.m.type]
  if (typeDiff !== 0) return typeDiff

  return compareModelsBySeries(a.m, b.m)
}

function getFilterChipClass(active: boolean, dimmed = false): string {
  const activeClass = UI_CHIP_ACTIVE_STRONG_CLASS
  const idleClass =
    'border-zinc-700/45 bg-zinc-800/85 text-zinc-100 hover:border-zinc-600/55 hover:bg-zinc-700/85'

  return `h-8 px-3 text-xs ${active ? activeClass : idleClass} ${dimmed && !active ? 'opacity-40' : ''}`
}

/**
 * 模型选择面板
 * 从 MediaGenerator 中提取的模型选择UI
 */
const ModelSelectorPanel: React.FC<ModelSelectorPanelProps> = ({
  selectedProvider,
  selectedModel,
  modelFilterProvider,
  modelFilterType,
  modelFilterFunction,
  favoriteModels,
  onModelSelect,
  onFilterProviderChange,
  onFilterTypeChange,
  onFilterFunctionChange,
  onToggleFavorite
}) => {
  const { t } = useTranslation('models')
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => getHiddenProviders())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => getHiddenTypes())
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => getHiddenModels())
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const highlightedItemRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const getColumnsCount = useCallback(() => {
    if (typeof window === 'undefined') return GRID_COLUMNS.default
    const width = window.innerWidth
    if (width >= 1280) return GRID_COLUMNS.xl
    if (width >= 1024) return GRID_COLUMNS.lg
    if (width >= 640) return GRID_COLUMNS.sm
    return GRID_COLUMNS.default
  }, [])
  useEffect(() => {
    setHiddenProviders(getHiddenProviders())
    setHiddenTypes(getHiddenTypes())
    setHiddenModels(getHiddenModels())
    const handleVisibilityChange = () => {
      setHiddenProviders(getHiddenProviders())
      setHiddenTypes(getHiddenTypes())
      setHiddenModels(getHiddenModels())
    }
    window.addEventListener('modelVisibilityChanged', handleVisibilityChange)
    return () => {
      window.removeEventListener('modelVisibilityChanged', handleVisibilityChange)
    }
  }, [])
  useEffect(() => {
    const shouldAutoFocusSearch = localStorage.getItem('enable_auto_focus_model_search') !== 'false'
    const timer = setTimeout(() => {
      if (shouldAutoFocusSearch) {
        searchInputRef.current?.focus()
      } else {
        wrapperRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [])
  const allProviders = getAvailableProviders()
  const visibleProviders = useMemo(() => {
    return getVisibleProviders(hiddenProviders, hiddenTypes, hiddenModels, allProviders)
  }, [hiddenProviders, hiddenTypes, hiddenModels, allProviders])
  const filteredAndSortedModels = useMemo(() => {
    const items = visibleProviders
      .flatMap(p => p.models.map(m => ({ p, m })))
      .filter(item => (modelFilterProvider === 'all' ? true : item.p.id === modelFilterProvider))
      .filter(item => {
        if (modelFilterType === 'favorite') {
          return favoriteModels.has(`${item.p.id}-${item.m.id}`)
        }
        return modelFilterType === 'all' ? true : item.m.type === modelFilterType
      })
      .filter(item => (modelFilterFunction === 'all' ? true : item.m.functions.includes(modelFilterFunction)))
    if (searchQuery.trim()) {
      return items
        .map(item => ({
          ...item,
          score: calculateMatchScore(item.m.name, searchQuery.trim())
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return compareModelItems(a, b)
        })
    }
    return items.map(item => ({ ...item, score: 100 }))
  }, [visibleProviders, modelFilterProvider, modelFilterType, modelFilterFunction, favoriteModels, searchQuery])
  useLayoutEffect(() => {
    const index = filteredAndSortedModels.findIndex(
      item => item.p.id === selectedProvider && item.m.id === selectedModel
    )
    setHighlightedIndex(index >= 0 ? index : 0)
  }, [searchQuery, modelFilterProvider, modelFilterType, modelFilterFunction, filteredAndSortedModels, selectedProvider, selectedModel])
  useEffect(() => {
    if (highlightedIndex >= filteredAndSortedModels.length && filteredAndSortedModels.length > 0) {
      setHighlightedIndex(filteredAndSortedModels.length - 1)
    }
  }, [filteredAndSortedModels.length, highlightedIndex])
  useEffect(() => {
    if (highlightedItemRef.current && gridContainerRef.current) {
      highlightedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [highlightedIndex])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const totalItems = filteredAndSortedModels.length
    if (totalItems === 0) return
    const columns = getColumnsCount()
    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const newIndex = prev - columns
          return newIndex >= 0 ? newIndex : prev
        })
        break
      }
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const newIndex = prev + columns
          return newIndex < totalItems ? newIndex : prev
        })
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev))
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        setHighlightedIndex(prev => (prev < totalItems - 1 ? prev + 1 : prev))
        break
      }
      case 'Enter': {
        e.preventDefault()
        if (highlightedItemRef.current) {
          highlightedItemRef.current.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window
          }))
          highlightedItemRef.current.click()
        } else {
          const highlightedItem = filteredAndSortedModels[highlightedIndex]
          if (highlightedItem) {
            onModelSelect(highlightedItem.p.id, highlightedItem.m.id)
          }
        }
        break
      }
    }
  }, [filteredAndSortedModels, highlightedIndex, getColumnsCount, onModelSelect])
  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 flex-col bg-zinc-900/40 outline-none"
    >
      {/* 筛选区域 - 固定在顶部 */}
      <div className="flex-shrink-0 bg-zinc-900/45 p-4 pb-2">
        {/* 搜索框 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">{t('search.label')}</div>
          <div className="relative">
            <UiInput
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('selectModel')}
              className="border-zinc-700/50 bg-zinc-800/70 pr-8 text-zinc-100 placeholder:text-zinc-500 hover:border-zinc-600/60"
            />
            {searchQuery && (
              <UiIconButton
                type="button"
                showBorder={false}
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 border-transparent bg-transparent text-zinc-400 hover:bg-zinc-700/60"
                title={t('search.clear')}
              >
                <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </UiIconButton>
            )}
          </div>
        </div>
        {/* 供应商 / 类型筛选 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">{t('filters.providerType')}</div>
          <div className="flex flex-wrap gap-2">
            <UiChipButton
              type="button"
              active={modelFilterProvider === 'all'}
              onClick={() => onFilterProviderChange('all')}
              className={getFilterChipClass(modelFilterProvider === 'all')}
            >
              {t('all')}
            </UiChipButton>
            {allProviders.map(p => (
              <UiChipButton
                key={p.id}
                type="button"
                active={modelFilterProvider === p.id}
                onClick={() => onFilterProviderChange(p.id)}
                className={getFilterChipClass(modelFilterProvider === p.id)}
              >
                {t(`providers.${p.id}`, p.name)}
              </UiChipButton>
            ))}
            <div className="w-px bg-zinc-600/50 mx-1"></div>
            {[
              { label: t('all'), value: 'all' },
              { label: t('favorites'), value: 'favorite' },
              { label: t('types.image'), value: 'image' },
              { label: t('types.video'), value: 'video' },
              { label: t('types.audio'), value: 'audio' }
            ].map(typeOption => {
              const isTypeHidden = typeOption.value !== 'all' && typeOption.value !== 'favorite' && hiddenTypes.has(typeOption.value)
              return (
                <UiChipButton
                  key={typeOption.value}
                  type="button"
                  active={modelFilterType === typeOption.value}
                  onClick={() => onFilterTypeChange(typeOption.value as 'all' | 'favorite' | 'image' | 'video' | 'audio')}
                  className={getFilterChipClass(modelFilterType === typeOption.value, isTypeHidden)}
                >
                  {typeOption.label}
                </UiChipButton>
              )
            })}
          </div>
        </div>
        {/* 功能筛选 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">{t('filters.function')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: t('all'), value: 'all' },
              ...FILTERABLE_TAGS.map(tag => ({
                label: t(`tags.${tag}`),
                value: tag
              }))
            ].map(f => (
              <UiChipButton
                key={f.value}
                type="button"
                active={modelFilterFunction === f.value}
                onClick={() => onFilterFunctionChange(f.value)}
                className={getFilterChipClass(modelFilterFunction === f.value)}
              >
                {f.label}
              </UiChipButton>
            ))}
          </div>
        </div>
      </div>
      {/* 模型列表 - 可滚动区域 */}
      <div ref={gridContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {filteredAndSortedModels.map(({ p, m }, index) => {
            const isHighlighted = index === highlightedIndex
            const isSelected = p.id === selectedProvider && m.id === selectedModel
            return (
              <UiOptionButton
                type="button"
                key={`${p.id}-${m.id}`}
                ref={isHighlighted ? highlightedItemRef : null}
                data-close-on-select
                onClick={() => onModelSelect(p.id, m.id)}
                active={isSelected}
                variant="card"
                className={`relative w-full flex-col items-start border px-3 py-2.5 ${isSelected
                  ? UI_CARD_ACTIVE_STRONG_CLASS
                  : 'border-zinc-700/45 bg-zinc-600/10 text-zinc-100 hover:border-zinc-600/55 hover:bg-zinc-700/40'
                  } ${isHighlighted ? UI_HIGHLIGHT_RING_INSET_CLASS : ''}`}
              >
                {/* 两列两行（表格式）: 左列=名称/供应商，右列=收藏/类型 */}
                <div className={`grid w-full grid-cols-[minmax(0,1fr)_auto] ${MODEL_CARD_COLUMN_GAP_CLASS} ${MODEL_CARD_ROW_GAP_CLASS}`}>
                  <UiMarqueeText
                    text={m.name}
                    className="col-start-1 row-start-1 min-w-0 text-left text-sm leading-5"
                  />
                  <div className="col-start-2 row-start-1 justify-self-end self-start">
                    <span
                      data-prevent-close
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(e, p.id, m.id) }}
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent text-zinc-500 transition-colors hover:bg-zinc-700/60"
                      title={favoriteModels.has(`${p.id}-${m.id}`) ? t('favorite.remove') : t('favorite.add')}
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-all ${favoriteModels.has(`${p.id}-${m.id}`) ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-zinc-500'}`}
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </span>
                  </div>
                  <span className={`col-start-1 row-start-2 block min-w-0 self-end truncate text-left ${MODEL_CARD_META_TEXT_CLASS}`}>
                    {t(`providers.${p.id}`, p.name)}
                  </span>
                  <span className={`col-start-2 row-start-2 justify-self-end self-end text-right ${MODEL_CARD_META_TEXT_CLASS}`}>
                    {m.type === 'image' ? t('types.image') : m.type === 'video' ? t('types.video') : t('types.audio')}
                  </span>
                </div>
              </UiOptionButton>
            )
          })}
        </div>
      </div>
    </div>
  )
}
export default ModelSelectorPanel
