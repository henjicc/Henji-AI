import { MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UI_TEXT_META_CLASS, UiButton, UiIconButton, UiOptionButton } from '@/components/ui'
import type { GenerationHistoryMediaType } from '@/stores/generationHistoryFilterStore'

export interface GenerationHistoryToolbarProps {
  mediaType: GenerationHistoryMediaType
  mediaOptions: Array<{ label: string; value: GenerationHistoryMediaType }>
  onMediaTypeChange: (mediaType: GenerationHistoryMediaType) => void
  /** 搜索与筛选条是否展开。 */
  searchOpen: boolean
  onToggleSearch: () => void
  /** 是否有生效中的筛选（筛选条收起时搜索按钮仍保持开态，提示列表被筛过）。 */
  hasActiveFilters: boolean
  matchedCount: number
  totalCount: number
  onOpenClearHistory: () => void
}

/**
 * 生成记录的命令带（设计稿 Generation）：左侧“全部/图片/视频/音频”静默分段，
 * 右侧搜索与“更多”（清除历史收进更多菜单）。搜索展开或筛选生效时在右侧显示命中数。
 */
export function GenerationHistoryToolbar({
  mediaType,
  mediaOptions,
  onMediaTypeChange,
  searchOpen,
  onToggleSearch,
  hasActiveFilters,
  matchedCount,
  totalCount,
  onOpenClearHistory,
}: GenerationHistoryToolbarProps): JSX.Element {
  const { t } = useI18n()
  const filtering = searchOpen || hasActiveFilters

  return (
    <div className="flex h-10 items-center justify-between gap-3">
      <div role="radiogroup" aria-label={t('ui:workspaceFilters.typeTabs')} className="flex min-w-0 items-center gap-0.5">
        {/* 只有“全部”一项（还没有任何记录）时不显示：单个选项不构成选择 */}
        {mediaOptions.length > 1 && mediaOptions.map((option) => (
          <UiOptionButton
            key={option.value}
            variant="segment"
            role="radio"
            aria-checked={mediaType === option.value}
            active={mediaType === option.value}
            onClick={() => onMediaTypeChange(option.value)}
          >
            {option.label}
          </UiOptionButton>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {filtering && (
          <span className={`mr-1.5 tabular-nums ${UI_TEXT_META_CLASS}`}>
            {t('ui:workspaceFilters.resultsCount', { matched: matchedCount, total: totalCount })}
          </span>
        )}
        <UiIconButton
          type="button"
          on={filtering}
          aria-expanded={searchOpen}
          onClick={onToggleSearch}
          title={t('ui:workspaceFilters.searchHistory')}
        >
          <Search className="h-4 w-4" />
        </UiIconButton>
        <PanelTrigger
          panelWidth={168}
          panelPadding="menu"
          closeOnPanelClick
          renderPanel={() => (
            <UiButton
              type="button"
              variant="danger"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={onOpenClearHistory}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('ui:actions.clearHistory')}
            </UiButton>
          )}
        >
          {({ open, togglePanel }) => (
            <UiIconButton
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={togglePanel}
              title={t('ui:workspaceFilters.moreActions')}
              data-panel-trigger-button
            >
              <MoreHorizontal className="h-4 w-4" />
            </UiIconButton>
          )}
        </PanelTrigger>
      </div>
    </div>
  )
}
