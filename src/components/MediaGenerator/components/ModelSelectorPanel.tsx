import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FILTERABLE_TAGS } from '@/core/types/ModelTags'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'
import { UiChipButton, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import PinyinMatch from 'pinyin-match'
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
          return a.m.name.localeCompare(b.m.name)
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
      className="flex flex-col h-full min-h-0 outline-none"
    >
      {/* 筛选区域 - 固定在顶部 */}
      <div className="flex-shrink-0 p-4 pb-0">
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
              className="pr-8"
            />
            {searchQuery && (
              <UiIconButton
                type="button"
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
              className="h-8 px-3 text-xs"
            >
              {t('all')}
            </UiChipButton>
            {allProviders.map(p => (
              <UiChipButton
                key={p.id}
                type="button"
                active={modelFilterProvider === p.id}
                onClick={() => onFilterProviderChange(p.id)}
                className="h-8 px-3 text-xs"
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
                  className={`h-8 px-3 text-xs ${isTypeHidden && modelFilterType !== typeOption.value ? 'opacity-40' : ''}`}
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
                className="h-8 px-3 text-xs"
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
            return (
              <UiOptionButton
                type="button"
                key={`${p.id}-${m.id}`}
                ref={isHighlighted ? highlightedItemRef : null}
                data-close-on-select
                onClick={() => onModelSelect(p.id, m.id)}
                active={isHighlighted}
                className={`relative w-full flex-col items-start px-3 py-3 ${isHighlighted ? 'ring-1 ring-[#007eff]/60' : ''}`}
              >
                {/* 收藏按钮 */}
                <UiIconButton
                  type="button"
                  data-prevent-close
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleFavorite(e, p.id, m.id)
                  }}
                  className="absolute top-1 right-1 z-10 h-6 w-6 border-transparent bg-transparent hover:bg-zinc-700/60"
                  title={favoriteModels.has(`${p.id}-${m.id}`) ? t('favorite.remove') : t('favorite.add')}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-all ${favoriteModels.has(`${p.id}-${m.id}`)
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'fill-none text-zinc-500'
                      }`}
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </UiIconButton>
                {/* 模型名称 */}
                <div className="text-sm mb-1 pr-6">{m.name}</div>
                {/* 底部信息行 */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">{t(`providers.${p.id}`, p.name)}</span>
                  <span className="text-zinc-400">{m.type === 'image' ? t('types.image') : m.type === 'video' ? t('types.video') : t('types.audio')}</span>
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
