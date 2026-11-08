import { UI_ICON_SIZE_CLASS, UI_OPTION_CELL_ACTIVE_META_CLASS } from '@/components/ui/styleTokens'
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGrid } from 'lucide-react'
import { MODEL_TAG_DEFINITIONS } from '@/core/types/ModelTags'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { providerBrandId } from '@/core/config/providerBrands'
import { getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'
import {
  Dropdown,
  UiFieldLayoutContext,
  UiNavButton,
  UiSearchInput,
  UiOptionButton,
  UiSpecialPanel,
  UiVirtualList,
  UiEmpty,
  UiMarqueeText,
  specialPanelGridWidth,
  useSpecialPanelColumns,
} from '@/components/ui'
import PinyinMatch from 'pinyin-match'
import { PROVIDER_ORDER, compareModelsBySeries, getModelTypeGroup, getModelTypeOrder } from '@/core/modelSortOrder'
import type { ModelType } from '@/core/types'
import type { GenerationModelFilterType } from '@/features/generation/domain/generationDraft'
import { ICON_PRESET } from '@/core/theme/icons'
interface ModelGridCellProps {
  providerId: string
  modelId: string
  modelName: string
  /** 只看单个供应商时不显示 */
  providerName: string | null
  selected: boolean
  favorite: boolean
  highlighted: boolean
  cellRef: React.Ref<HTMLButtonElement>
  favoriteLabel: string
  onSelect: () => void
  onToggleFavorite: (e: React.MouseEvent) => void
}

/**
 * 模型格：名字过长时悬停整格循环滚动，不弹提示。
 * 未收藏时星标与供应商名共用右侧同一个位置，悬停时供应商名淡出、星标淡入，格内不发生位移；
 * 已收藏的格子把实心星标常驻在供应商名前面，同名模型仍能靠供应商名区分。
 */
function ModelGridCell({
  providerId, modelId, modelName, providerName, selected, favorite, highlighted, cellRef, favoriteLabel, onSelect, onToggleFavorite,
}: ModelGridCellProps): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const metaTone = selected ? UI_OPTION_CELL_ACTIVE_META_CLASS : 'text-text3'
  const favoriteToggle = (placement: string): JSX.Element => (
    <span
      data-prevent-close
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(e) }}
      className={`cursor-pointer transition-opacity duration-120 ${placement}`}
      aria-label={favoriteLabel}
    >
      <ICON_PRESET className={`${UI_ICON_SIZE_CLASS.sm} ${favorite ? 'fill-warning-text text-warning-text' : `fill-none ${metaTone}`}`} />
    </span>
  )
  return (
    <UiOptionButton
      type="button"
      data-provider-id={providerId}
      data-model-id={modelId}
      ref={cellRef}
      data-close-on-select
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      active={selected}
      // 二维网格：grid 变体静息铺一层极淡底撑出格子形状，不描边；方向键当前项用悬停底
      variant="grid"
      size="md"
      highlighted={highlighted}
      className="group w-full gap-1.5"
    >
      <UiMarqueeText text={modelName} playing={hovered} className="min-w-0 flex-1 text-left" />
      <span className="relative flex min-w-4 shrink-0 items-center justify-end gap-1">
        {favorite ? favoriteToggle('inline-flex') : null}
        {providerName ? (
          <span className={`text-2xs transition-opacity duration-120 ${metaTone} ${favorite ? '' : 'group-hover:opacity-0 group-focus-visible:opacity-0'}`}>{providerName}</span>
        ) : null}
        {favorite ? null : favoriteToggle('absolute right-0 inline-flex opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}
      </span>
    </UiOptionButton>
  )
}

interface ModelSelectorPanelProps {
  selectedProvider: string
  selectedModel: string
  modelFilterProvider: string
  modelFilterType: GenerationModelFilterType
  modelFilterFunction: string
  favoriteModels: Set<string>
  onModelSelect: (providerId: string, modelId: string) => void
  onFilterProviderChange: (provider: string) => void
  onFilterTypeChange: (type: GenerationModelFilterType) => void
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

// 特殊面板（重要记录 021）：左栏 128 + 三列网格，单元 200 × 32；整块不超过 760
const CELL_WIDTH = 200
const CELL_GAP = 6
const GRID_CHROME = 128 + 1 + 16 + 2
const TYPE_FILTERS: Array<Exclude<GenerationModelFilterType, 'favorite'>> = ['all', 'image', 'video', 'audio', 'other']

/** 选了某种类型时只列这种类型的能力；当前选中的能力始终保留，免得切换类型后筛选值没有对应选项。 */
function functionTagsFor(type: GenerationModelFilterType, selected: string): string[] {
  const tags = MODEL_TAG_DEFINITIONS.filter((tag) => type !== 'image' && type !== 'video' && type !== 'audio' || tag.mediaType === type).map((tag) => tag.id as string)
  return selected === 'all' || tags.includes(selected) ? tags : [selected, ...tags]
}
const TYPE_GROUPS = ['image', 'video', 'audio', 'other'] as const

type ModelEntry = { p: { id: string; name: string }; m: { id: string; type: ModelType; name: string; functions: string[]; seriesId?: string; seriesRank?: number } }
type GridRow =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'cards'; key: string; start: number; items: ModelEntry[] }

function compareModelItems(a: ModelEntry, b: ModelEntry): number {
  const providerDiff = (PROVIDER_ORDER[a.p.id] ?? Number.MAX_SAFE_INTEGER) - (PROVIDER_ORDER[b.p.id] ?? Number.MAX_SAFE_INTEGER)
  if (providerDiff !== 0) return providerDiff

  const typeDiff = getModelTypeOrder(a.m.type) - getModelTypeOrder(b.m.type)
  if (typeDiff !== 0) return typeDiff

  return compareModelsBySeries(a.m, b.m)
}

/** 按网格排成行：不搜索且类型为“全部”时按类型分段（每段一个标题行），其余直接排。 */
function buildGridRows(items: ModelEntry[], columns: number, sectioned: boolean, typeLabel: (group: string) => string): GridRow[] {
  const rows: GridRow[] = []
  const pushCards = (entries: ModelEntry[], offset: number, prefix: string): void => {
    for (let index = 0; index < entries.length; index += columns) {
      rows.push({ kind: 'cards', key: `${prefix}:${index}`, start: offset + index, items: entries.slice(index, index + columns) })
    }
  }
  if (!sectioned) {
    pushCards(items, 0, 'all')
    return rows
  }
  let offset = 0
  for (const group of TYPE_GROUPS) {
    const entries = items.filter(item => getModelTypeGroup(item.m.type) === group)
    if (entries.length === 0) continue
    rows.push({ kind: 'header', key: `header:${group}`, label: typeLabel(group), count: entries.length })
    pushCards(entries, offset, group)
    offset += entries.length
  }
  return rows
}

/** 方向键在分段网格里移动：左右按顺序，上下到相邻的卡片行、同一列（那行不够长就取末项）。 */
function moveHighlight(rows: GridRow[], current: number, key: string): number {
  const cardRows = rows.filter((row): row is Extract<GridRow, { kind: 'cards' }> => row.kind === 'cards')
  const total = cardRows.reduce((sum, row) => sum + row.items.length, 0)
  if (total === 0) return current
  if (key === 'ArrowLeft') return Math.max(0, current - 1)
  if (key === 'ArrowRight') return Math.min(total - 1, current + 1)
  const rowIndex = cardRows.findIndex(row => current >= row.start && current < row.start + row.items.length)
  if (rowIndex < 0) return 0
  const column = current - cardRows[rowIndex].start
  const target = cardRows[rowIndex + (key === 'ArrowDown' ? 1 : -1)]
  if (!target) return current
  return target.start + Math.min(column, target.items.length - 1)
}

/**
 * 模型选择面板（特殊面板，重要记录 021）：左栏“全部 / 收藏 / 各供应商”，右边头部一行搜索、类型与功能，
 * 正文三列网格、不搜索时按类型分段；生成页底栏、图片编辑扩图、剪辑里的生成共用。
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
  const [keyboardHighlight, setKeyboardHighlight] = useState<{ resultKey: string; index: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const highlightedItemRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const columns = useSpecialPanelColumns({ cellWidth: CELL_WIDTH, gap: CELL_GAP, chrome: GRID_CHROME, maxColumns: 3 }, wrapperRef)
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
  const providerBrands = [...new Map(allProviders.map(provider => [providerBrandId(provider.id), { ...provider, id: providerBrandId(provider.id) }])).values()]
  const visibleProviders = useMemo(() => {
    return getVisibleProviders(hiddenProviders, hiddenTypes, hiddenModels, allProviders)
  }, [hiddenProviders, hiddenTypes, hiddenModels, allProviders])
  const allEntries = useMemo<ModelEntry[]>(() => visibleProviders.flatMap(p => p.models.map(m => ({ p, m }))), [visibleProviders])

  const matchesType = useCallback((item: ModelEntry): boolean => {
    if (modelFilterType === 'favorite') return favoriteModels.has(`${item.p.id}-${item.m.id}`)
    return modelFilterType === 'all' || getModelTypeGroup(item.m.type) === modelFilterType
  }, [favoriteModels, modelFilterType])
  const matchesProvider = useCallback((item: ModelEntry): boolean => modelFilterProvider === 'all'
    || providerBrandId(item.p.id) === providerBrandId(modelFilterProvider), [modelFilterProvider])
  const matchesFunction = useCallback((item: ModelEntry): boolean => modelFilterFunction === 'all'
    || item.m.functions.includes(modelFilterFunction), [modelFilterFunction])
  const functionTags = useMemo(() => functionTagsFor(modelFilterType, modelFilterFunction), [modelFilterType, modelFilterFunction])

  // 左栏数量：按当前类型与功能算各供应商的模型数，收藏按功能算
  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of allEntries) {
      if (!matchesType(item) || !matchesFunction(item)) continue
      const brand = providerBrandId(item.p.id)
      counts.set(brand, (counts.get(brand) ?? 0) + 1)
    }
    return counts
  }, [allEntries, matchesFunction, matchesType])
  const allCount = [...providerCounts.values()].reduce((sum, count) => sum + count, 0)
  const favoriteCount = allEntries.filter(item => matchesFunction(item) && favoriteModels.has(`${item.p.id}-${item.m.id}`)).length

  const filteredAndSortedModels = useMemo(() => {
    const items = allEntries.filter(item => matchesProvider(item) && matchesType(item) && matchesFunction(item))
    if (searchQuery.trim()) {
      return items
        .map(item => ({ ...item, score: calculateMatchScore(item.m.name, searchQuery.trim()) }))
        .filter(item => item.score > 0)
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : compareModelItems(a, b)))
    }
    return items
  }, [allEntries, matchesFunction, matchesProvider, matchesType, searchQuery])

  const sectioned = !searchQuery.trim() && modelFilterType === 'all'
  const rows = useMemo(
    () => buildGridRows(filteredAndSortedModels, columns, sectioned, group => t(`types.${group}`)),
    [columns, filteredAndSortedModels, sectioned, t]
  )
  // 网格里的显示顺序（分段后与原排序不同），方向键与回车按它走
  const orderedModels = useMemo(() => rows.flatMap(row => (row.kind === 'cards' ? row.items : [])), [rows])
  const selectedIndex = orderedModels.findIndex(item => item.p.id === selectedProvider && item.m.id === selectedModel)
  // 方向键移到的位置只对当前这组结果有效；搜索、筛选或选中项一变就回到当前选中的模型。
  // 高亮由渲染直接推导：列表第一次挂载就拿到正确的行，打开面板时才能停在当前模型上。
  const resultKey = `${searchQuery}:${modelFilterProvider}:${modelFilterType}:${modelFilterFunction}:${selectedProvider}:${selectedModel}`
  const defaultHighlight = selectedIndex >= 0 ? selectedIndex : 0
  const highlightedIndex = Math.min(
    keyboardHighlight?.resultKey === resultKey ? keyboardHighlight.index : defaultHighlight,
    Math.max(orderedModels.length - 1, 0),
  )
  const highlightedRow = rows.findIndex(row => row.kind === 'cards' && highlightedIndex >= row.start && highlightedIndex < row.start + row.items.length)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (orderedModels.length === 0) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setKeyboardHighlight({ resultKey, index: moveHighlight(rows, highlightedIndex, e.key) })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedItemRef.current) {
        highlightedItemRef.current.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
        highlightedItemRef.current.click()
        return
      }
      const highlightedItem = orderedModels[highlightedIndex]
      if (highlightedItem) onModelSelect(highlightedItem.p.id, highlightedItem.m.id)
    }
  }, [highlightedIndex, onModelSelect, orderedModels, resultKey, rows])

  // 左栏：全部 / 收藏 / 各供应商。收藏沿用“类型 = 收藏”的筛选，选供应商时回到全部类型
  const selectRail = (provider: string, favorite = false): void => {
    onFilterProviderChange(provider)
    if (favorite) onFilterTypeChange('favorite')
    else if (modelFilterType === 'favorite') onFilterTypeChange('all')
  }
  const railItem = (key: string, label: string, count: number, active: boolean, onClick: () => void, icon?: React.ReactNode): React.ReactNode => (
    <UiNavButton key={key} type="button" size="sm" active={active} onClick={onClick} className="w-full" data-model-filter-provider={key}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span className="font-mono text-2xs text-text3">{count}</span>
      </span>
    </UiNavButton>
  )
  const showProvider = modelFilterProvider === 'all'

  return (
    <UiSpecialPanel
      ref={wrapperRef}
      data-model-selector-panel
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      height="fill"
      bodyPadding="sm"
      bodyWidth={specialPanelGridWidth(columns, CELL_WIDTH, CELL_GAP)}
      header={(
        <UiFieldLayoutContext.Provider value="toolbar">
          <UiSearchInput
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            clearLabel={t('search.clear')}
            onClear={() => setSearchQuery('')}
            className="min-w-40 flex-1"
          />
          <div role="group" aria-label={t('filters.type')} className="flex shrink-0 items-center gap-0.5">
            {TYPE_FILTERS.map(type => (
              <UiOptionButton key={type} type="button" variant="menu" size="sm" active={modelFilterType === type} aria-pressed={modelFilterType === type}
                onClick={() => onFilterTypeChange(type)}>
                {type === 'all' ? t('all') : t(`types.${type}`)}
              </UiOptionButton>
            ))}
          </div>
          {/* 没按功能筛选时触发器只写“功能”，不再和类型筛选的“全部”并排出现两个“全部” */}
          <Dropdown size="sm" value={modelFilterFunction} display={modelFilterFunction === 'all' ? t('filters.function') : undefined} ariaLabel={t('filters.function')}
            options={[{ label: t('all'), value: 'all' }, ...functionTags.map(tag => ({ label: t(`tags.${tag}`), value: tag }))]}
            onSelect={onFilterFunctionChange} />
        </UiFieldLayoutContext.Provider>
      )}
      aside={(
        <div className="flex flex-col gap-0.5">
          {railItem('all', t('all'), allCount, modelFilterProvider === 'all' && modelFilterType !== 'favorite', () => selectRail('all'), <LayoutGrid className={UI_ICON_SIZE_CLASS.sm} />)}
          {railItem('favorite', t('favorites'), favoriteCount, modelFilterType === 'favorite', () => selectRail('all', true), <ICON_PRESET className={`${UI_ICON_SIZE_CLASS.sm} fill-warning-text text-warning-text`} />)}
          <span className="mx-2 my-1.5 h-px bg-line" aria-hidden />
          <span className="px-2 pb-0.5 text-2xs text-text3">{t('filters.provider')}</span>
          {providerBrands.map(provider => railItem(
            provider.id,
            provider.name,
            providerCounts.get(provider.id) ?? 0,
            modelFilterType !== 'favorite' && providerBrandId(modelFilterProvider) === provider.id,
            () => selectRail(provider.id),
          ))}
        </div>
      )}
    >
      {/* 列表伸进正文右侧 8 的留白：竖向滚动条落在留白里，三列 200 的格子不被挤出横向滚动条 */}
      <div className="-mr-2 flex min-h-0 flex-1 flex-col">
      <UiVirtualList
        data={rows}
        getKey={row => row.key}
        resetKey={`${searchQuery}:${modelFilterProvider}:${modelFilterType}:${modelFilterFunction}:${columns}`}
        highlightedIndex={highlightedRow >= 0 ? highlightedRow : undefined}
        emptyState={<UiEmpty size="xs" title={t('ui:workspaceFilters.emptyFiltered')} />}
        renderItem={(row) => row.kind === 'header' ? (
          <div className="flex h-7 items-end gap-1.5 pb-1.5 text-2xs text-text3">{row.label}<span className="font-mono">{row.count}</span></div>
        ) : (
          <div className="grid pb-1.5" style={{ gridTemplateColumns: `repeat(${columns}, ${CELL_WIDTH}px)`, columnGap: CELL_GAP }}>
            {row.items.map(({ p, m }, column) => {
              const index = row.start + column
              const isHighlighted = index === highlightedIndex
              const isSelected = p.id === selectedProvider && m.id === selectedModel
              const isFavorite = favoriteModels.has(`${p.id}-${m.id}`)
              return (
                <ModelGridCell
                  key={`${p.id}-${m.id}`}
                  providerId={p.id}
                  modelId={m.id}
                  modelName={m.name}
                  providerName={showProvider ? p.name : null}
                  selected={isSelected}
                  favorite={isFavorite}
                  highlighted={isHighlighted}
                  cellRef={isHighlighted ? highlightedItemRef : null}
                  favoriteLabel={isFavorite ? t('favorite.remove') : t('favorite.add')}
                  onSelect={() => onModelSelect(p.id, m.id)}
                  onToggleFavorite={(e) => onToggleFavorite(e, p.id, m.id)}
                />
              )
            })}
          </div>
        )}
      />
      </div>
    </UiSpecialPanel>
  )
}
export default ModelSelectorPanel
