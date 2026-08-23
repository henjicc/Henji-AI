import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FILTERABLE_TAGS } from '@/core/types/ModelTags'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'
import {
  UiIconButton,
  UiInput,
  UiMarqueeText,
  UiOptionButton,
  UI_HIGHLIGHT_RING_INSET_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
} from '@/components/ui'
import PinyinMatch from 'pinyin-match'
import { PROVIDER_ORDER, MODEL_TYPE_ORDER, compareModelsBySeries } from '@/core/modelSortOrder'
import { X } from 'lucide-react'
import { ICON_PRESET } from '@/core/theme/icons'
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
const MODEL_CARD_META_TEXT_CLASS = `${UI_TEXT_META_CLASS} leading-4`

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

// 筛选项是同质选项集合，走 UiOptionButton：静息保留描边（纯文字 chip 去框会变裸文字），
// 选中态由公共令牌给出，和下方模型网格、比例/分辨率面板是同一个蓝。
function getFilterChipClass(active: boolean, dimmed = false): string {
  return `h-8 px-3 text-xs ${dimmed && !active ? 'opacity-40' : ''}`
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
      data-model-selector-panel
      ref={wrapperRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // 表面由 PanelTrigger 的外壳统一提供，这里不再叠自己的底色
      // ——此前的 bg-panel/40 + /45 是让本面板比比例/分辨率面板整体偏暗的原因
      className="flex h-full min-h-0 flex-col outline-none"
    >
      {/* 筛选区域 - 固定在顶部 */}
      <div className="flex-shrink-0 p-4 pb-2">
        {/* 搜索框 */}
        <div className="mb-3">
          <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('search.label')}</div>
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
                showBorder={false}
                appearance="hover-only"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2"
                title={t('search.clear')}
              >
                <X className="w-4 h-4" />
              </UiIconButton>
            )}
          </div>
        </div>
        {/* 供应商 / 类型筛选 */}
        <div className="mb-3">
          <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('filters.providerType')}</div>
          <div className="flex flex-wrap gap-2">
            <UiOptionButton
              type="button"
              active={modelFilterProvider === 'all'}
              onClick={() => onFilterProviderChange('all')}
              className={getFilterChipClass(modelFilterProvider === 'all')}
            >
              {t('all')}
            </UiOptionButton>
            {allProviders.map(p => (
              <UiOptionButton
                key={p.id}
                type="button"
                active={modelFilterProvider === p.id}
                onClick={() => onFilterProviderChange(p.id)}
                className={getFilterChipClass(modelFilterProvider === p.id)}
              >
                {p.name}
              </UiOptionButton>
            ))}
            <div className="w-px bg-border-dark mx-1"></div>
            {[
              { label: t('all'), value: 'all' },
              { label: t('favorites'), value: 'favorite' },
              { label: t('types.image'), value: 'image' },
              { label: t('types.video'), value: 'video' },
              { label: t('types.audio'), value: 'audio' }
            ].map(typeOption => {
              const isTypeHidden = typeOption.value !== 'all' && typeOption.value !== 'favorite' && hiddenTypes.has(typeOption.value)
              return (
                <UiOptionButton
                  key={typeOption.value}
                  type="button"
                  active={modelFilterType === typeOption.value}
                  onClick={() => onFilterTypeChange(typeOption.value as 'all' | 'favorite' | 'image' | 'video' | 'audio')}
                  className={getFilterChipClass(modelFilterType === typeOption.value, isTypeHidden)}
                >
                  {typeOption.label}
                </UiOptionButton>
              )
            })}
          </div>
        </div>
        {/* 功能筛选 */}
        <div className="mb-3">
          <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('filters.function')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: t('all'), value: 'all' },
              ...FILTERABLE_TAGS.map(tag => ({
                label: t(`tags.${tag}`),
                value: tag
              }))
            ].map(f => (
              <UiOptionButton
                key={f.value}
                type="button"
                active={modelFilterFunction === f.value}
                onClick={() => onFilterFunctionChange(f.value)}
                className={getFilterChipClass(modelFilterFunction === f.value)}
              >
                {f.label}
              </UiOptionButton>
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
                data-provider-id={p.id}
                data-model-id={m.id}
                ref={isHighlighted ? highlightedItemRef : null}
                data-close-on-select
                onClick={() => onModelSelect(p.id, m.id)}
                active={isSelected}
                variant="menu"
                // 网格是二维的：静息态留一层极淡底色撑出格子形状（否则列边界会糊），
                // 但不再描边——底色已经表达过一次边界，边框是多余的第二次。
                className={`relative w-full flex-col items-start px-3 py-2.5 ${
                  isSelected ? '' : 'bg-veil-faint'
                } ${isHighlighted ? UI_HIGHLIGHT_RING_INSET_CLASS : ''}`}
              >
                {/* 两列两行（表格式）: 左列=名称/供应商，右列=收藏/类型 */}
                <div className={`grid w-full grid-cols-[minmax(0,1fr)_auto] ${MODEL_CARD_COLUMN_GAP_CLASS} ${MODEL_CARD_ROW_GAP_CLASS}`}>
                  <UiMarqueeText
                    text={m.name}
                    className={`col-start-1 row-start-1 min-w-0 text-left leading-5 ${UI_TEXT_BODY_CLASS}`}
                  />
                  <div className="col-start-2 row-start-1 justify-self-end self-start">
                    <span
                      data-prevent-close
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(e, p.id, m.id) }}
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent text-text-muted transition-colors hover:bg-layer"
                      title={favoriteModels.has(`${p.id}-${m.id}`) ? t('favorite.remove') : t('favorite.add')}
                    >
                      <ICON_PRESET
                        className={`h-3.5 w-3.5 transition-colors ${favoriteModels.has(`${p.id}-${m.id}`) ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-text-muted'}`}
                      />
                    </span>
                  </div>
                  <span className={`col-start-1 row-start-2 block min-w-0 self-end truncate text-left ${isSelected ? 'text-xs leading-4 text-white/80' : MODEL_CARD_META_TEXT_CLASS}`}>
                    {p.name}
                  </span>
                  <span className={`col-start-2 row-start-2 justify-self-end self-end text-right ${isSelected ? 'text-xs leading-4 text-white/80' : MODEL_CARD_META_TEXT_CLASS}`}>
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
