import { UiSegmented } from '@/components/ui'
import type { ReactNode } from 'react'
import { MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UI_TEXT_META_CLASS, UiIconButton, UiOptionButton } from '@/components/ui'
import { ICON_MULTI_SELECT, UI_ICON_SIZE } from '@/core/theme/icons'
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
  /** 命令带右端的状态入口（开发用的测试模式徽标）：放在带内，窄窗口下不压住搜索按钮。 */
  trailingStatus?: ReactNode
  /** 搜索展开时占据搜索按钮位置的搜索框与筛选（同一行，不另起一条带）。 */
  searchField?: ReactNode
  /** 从属带：只随当前筛选出现的参数（自定义时间的起止日期），紧贴命令带下方。 */
  subordinate?: ReactNode
  /** 进入多选。 */
  onEnterSelection?: () => void
  /** 多选时整条命令带换成选择带（退出、计数、批量动作），不另起一行。 */
  selectionBar?: ReactNode
}

/**
 * 生成记录的命令带（设计稿 Generation）：一行。左侧“全部/图片/视频/音频”分段，紧跟搜索与“更多”
 * （清除历史收进更多菜单）；搜索展开时搜索按钮原地换成搜索框与筛选，不另起一行。
 * 右端只放只读状态：搜索展开或筛选生效时的命中数。
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
  trailingStatus,
  searchField,
  subordinate,
  onEnterSelection,
  selectionBar,
}: GenerationHistoryToolbarProps): JSX.Element {
  const { t } = useI18n()
  const filtering = searchOpen || hasActiveFilters

  return (
    <div className="flex min-w-0 flex-col">
    {selectionBar ? <div className="flex h-10 min-w-0 items-center">{selectionBar}</div> : (
    <div className="flex h-10 min-w-0 items-center gap-3">
      {mediaOptions.length > 1 && <div className="shrink-0"><UiSegmented ariaLabel={t('ui:workspaceFilters.typeTabs')} value={mediaType} onChange={onMediaTypeChange} options={mediaOptions} /></div>}
      <div className="flex min-w-0 items-center gap-1">
        {searchOpen && searchField ? searchField : (
          <UiIconButton
            type="button"
            on={filtering}
            aria-expanded={searchOpen}
            onClick={onToggleSearch}
            tooltip={t('ui:workspaceFilters.searchHistory')}
          >
            <Search  />
          </UiIconButton>
        )}
        {onEnterSelection && (
          <UiIconButton type="button" onClick={onEnterSelection} tooltip={t('ui:generationSelection.enter')}>
            <ICON_MULTI_SELECT />
          </UiIconButton>
        )}
        <PanelTrigger
          panelSize="menu"
          panelPadding="menu"
          closeOnPanelClick
          renderPanel={() => (
            <UiOptionButton type="button" variant="menu" size="sm" role="menuitem" className="w-full gap-2" onClick={onOpenClearHistory}>
              <span className="flex min-w-0 flex-1 items-center gap-2 text-danger-text"><Trash2 size={UI_ICON_SIZE.sm} /><span className="min-w-0 flex-1 truncate">{t('ui:actions.clearHistory')}</span></span>
            </UiOptionButton>
          )}
        >
          {({ open, togglePanel }) => (
            <UiIconButton
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={togglePanel}
              tooltip={t('ui:workspaceFilters.moreActions')}
              data-panel-trigger-button
            >
              <MoreHorizontal  />
            </UiIconButton>
          )}
        </PanelTrigger>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {filtering && (
          <span className={`tabular-nums ${UI_TEXT_META_CLASS}`}>
            {t('ui:workspaceFilters.resultsCount', { matched: matchedCount, total: totalCount })}
          </span>
        )}
        {trailingStatus ? <span className="flex items-center">{trailingStatus}</span> : null}
      </div>
    </div>
    )}
    {subordinate ? <div className="flex h-10 min-w-0 items-center">{subordinate}</div> : null}
    </div>
  )
}
