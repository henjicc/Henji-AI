import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { getLogCaptureMode } from '@/commands/logging'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  PanelTrigger, UiButton, UiCheckbox, UiFieldTrigger, UiInput, UiOverflowRow, UiSegmented, UiSelect, UiToolbar,
  type UiOverflowRowItem,
} from '@/components/ui'
import { UI_INLINE_GAP_CLASS } from '@/components/ui/styleTokens'
import type { LogLevel } from '../eventDisplay'

export type SourceFilter = 'all' | 'frontend' | 'backend'
export type LevelFilter = 'all' | LogLevel
/** 实时模式：订阅内存缓冲；历史模式：从主进程按日期查询磁盘日志文件（2.3 历史日志回读）。 */
export type LogViewMode = 'live' | 'history'

const LEVEL_VALUES: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

interface LogFilterToolbarProps {
  /** 日志窗口顶层的“事件日志 / 助手追踪”切换，放在命令带最左端（任务 5.7：不再单独占一条带）。 */
  surfaceSwitch: ReactNode
  mode: LogViewMode
  onModeChange: (mode: LogViewMode) => void
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
  levelFilter: LevelFilter
  onLevelFilterChange: (value: LevelFilter) => void
  domainFilter: string
  onDomainFilterChange: (value: string) => void
  domainOptions: string[]
  keyword: string
  onKeywordChange: (value: string) => void
  /** "只看错误"快捷开关：等价于把级别过滤收窄到 error，但独立于 levelFilter 单独展示。 */
  errorOnly: boolean
  onErrorOnlyChange: (value: boolean) => void
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
  /** 按 requestId 直接查链路（工具栏输入/粘贴 requestId 后触发，不受当前过滤条件影响）。 */
  onLookupRequestId: (requestId: string) => void
  /** 历史模式专用：日期列表（来自 `listLogDates`）、当前选中日期、切换回调。实时模式下忽略。 */
  historyDates: string[]
  selectedHistoryDate: string
  onSelectedHistoryDateChange: (date: string) => void
  /** 历史模式当前查询期间跳过的损坏行数，非历史模式或无损坏行时为 0。 */
  historyCorruptedLines: number
}

/**
 * 日志窗口工具栏：来源/级别/domain/关键词过滤 + 只看错误 + 暂停恢复 + 清空 +
 * 完整捕获开关 + requestId 链路查询。完整捕获开关（原挂在 TestModePanel）在此落地，
 * 交互与状态读写方式不变（见 2.1 decisions.md）。
 *
 * 骨架（任务 5.7）：一条命令带（视图切换、实时/历史、模式相关动作、完整捕获）+ 从属带（过滤条件），
 * 共用同一块底色与下边框。
 */
export function LogFilterToolbar({
  surfaceSwitch,
  mode,
  onModeChange,
  sourceFilter,
  onSourceFilterChange,
  levelFilter,
  onLevelFilterChange,
  domainFilter,
  onDomainFilterChange,
  domainOptions,
  keyword,
  onKeywordChange,
  errorOnly,
  onErrorOnlyChange,
  paused,
  onTogglePause,
  onClear,
  onLookupRequestId,
  historyDates,
  selectedHistoryDate,
  onSelectedHistoryDateChange,
  historyCorruptedLines,
}: LogFilterToolbarProps): JSX.Element {
  const { t } = useI18n('ui')
  const captureMode = useSettingsStore((state) => state.logCaptureMode)
  const setCaptureMode = useSettingsStore((state) => state.setLogCaptureMode)
  const [chainQuery, setChainQuery] = useState('')

  function handleChainLookup(): void {
    const trimmed = chainQuery.trim()
    if (trimmed) {
      onLookupRequestId(trimmed)
    }
  }

  useEffect(() => {
    // 日志窗口是独立渲染进程，`logCaptureMode` 本地默认值 standard 未必等于主进程真实状态
    // （该字段有意不持久化，见 settingsStore.ts）；挂载时主动拉取一次纠正 UI 显示。
    let cancelled = false
    void getLogCaptureMode().then((mode) => {
      if (!cancelled) {
        setCaptureMode(mode)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeFilterIds = new Set([
    ...(sourceFilter !== 'all' ? ['source'] : []),
    ...(levelFilter !== 'all' ? ['level'] : []),
    ...(domainFilter !== 'all' ? ['domain'] : []),
    ...(errorOnly ? ['errorOnly'] : []),
  ])

  // priority 越大越晚收起；关键词搜索最常用，永不收起。
  const filterItems: UiOverflowRowItem[] = [
    {
      id: 'source',
      priority: 50,
      node: (
        <UiSelect
          value={sourceFilter}
          onChange={(event) => onSourceFilterChange(event.target.value as SourceFilter)}
          className="w-28"
        >
          <option value="all">{t('logsWindow.toolbar.source.all')}</option>
          <option value="frontend">{t('logsWindow.toolbar.source.frontend')}</option>
          <option value="backend">{t('logsWindow.toolbar.source.backend')}</option>
        </UiSelect>
      ),
    },
    {
      id: 'level',
      priority: 60,
      node: (
        <UiSelect
          value={levelFilter}
          onChange={(event) => onLevelFilterChange(event.target.value as LevelFilter)}
          className="w-28"
        >
          <option value="all">{t('logsWindow.toolbar.level.all')}</option>
          {LEVEL_VALUES.map((level) => (
            <option key={level} value={level}>{level.toUpperCase()}</option>
          ))}
        </UiSelect>
      ),
    },
    {
      id: 'domain',
      priority: 40,
      node: (
        <UiSelect
          value={domainFilter}
          onChange={(event) => onDomainFilterChange(event.target.value)}
          className="w-40"
        >
          <option value="all">{t('logsWindow.toolbar.domain.all')}</option>
          {domainOptions.map((domain) => (
            <option key={domain} value={domain}>{domain}</option>
          ))}
        </UiSelect>
      ),
    },
    {
      id: 'keyword',
      priority: 100,
      pinned: true,
      fillFrom: 160,
      node: (
        <UiInput
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder={t('logsWindow.toolbar.keywordPlaceholder')}
          className="w-full"
        />
      ),
    },
    {
      id: 'errorOnly',
      priority: 30,
      node: (
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2">
          <UiCheckbox checked={errorOnly} onCheckedChange={onErrorOnlyChange} />
          {t('logsWindow.toolbar.errorOnly')}
        </label>
      ),
    },
    {
      id: 'chain',
      priority: 10,
      node: (
        <div className="flex shrink-0 items-center gap-1">
          <UiInput
            value={chainQuery}
            onChange={(event) => setChainQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleChainLookup()
              }
            }}
            placeholder={t('logsWindow.toolbar.chainLookupPlaceholder')}
            className="w-36"
          />
          <UiButton type="button" className="shrink-0" onClick={handleChainLookup}>
            {t('logsWindow.chain.viewButton')}
          </UiButton>
        </div>
      ),
    },
  ]

  return (
    <UiToolbar
      variant="command"
      trailing={
        <>
          {mode === 'live' ? (
            <>
              <UiButton type="button" onClick={onTogglePause}>
                {paused ? t('logsWindow.toolbar.resume') : t('logsWindow.toolbar.pause')}
              </UiButton>
              <UiButton type="button" onClick={onClear}>
                {t('logsWindow.toolbar.clear')}
              </UiButton>
            </>
          ) : (
            <>
              <UiSelect
                value={selectedHistoryDate}
                onChange={(event) => onSelectedHistoryDateChange(event.target.value)}
                className="w-40"
                disabled={historyDates.length === 0}
              >
                {historyDates.length === 0 ? (
                  <option value="">{t('logsWindow.toolbar.historyDate.empty')}</option>
                ) : (
                  historyDates.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))
                )}
              </UiSelect>
              {historyCorruptedLines > 0 && (
                <span className="text-2xs text-warning-text">
                  {t('logsWindow.toolbar.historyDate.corrupted', { count: historyCorruptedLines })}
                </span>
              )}
            </>
          )}
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2" title={t('logsWindow.toolbar.captureMode.description')}>
            <UiCheckbox
              checked={captureMode === 'full'}
              onCheckedChange={(checked) => setCaptureMode(checked ? 'full' : 'standard')}
            />
            {t('logsWindow.toolbar.captureMode.title')}
          </label>
        </>
      }
      subordinate={
        // 窄窗口下一行放不下全部筛选：按使用频率从链路查询起收进“更多筛选”。
        // 选择框不能靠 flex 收缩让位，否则内边距吃掉文字区，选择框显示成空白。
        <UiOverflowRow
          className={`flex-1 ${UI_INLINE_GAP_CLASS.row}`}
          items={filterItems}
          renderOverflow={(hiddenIds) => {
            // 收起的筛选仍在生效：入口要说出来，否则列表少了条目却看不出原因
            const activeCount = hiddenIds.filter((id) => activeFilterIds.has(id)).length
            const label = t('logsWindow.toolbar.moreFilters')
            const status = activeCount > 0 ? t('logsWindow.toolbar.activeFilters', { count: activeCount }) : null
            return (
              <PanelTrigger panelSize="menu" panelPadding="content" renderPanel={() => (
                <div className="flex flex-col items-start gap-3">
                  {filterItems.filter((item) => hiddenIds.includes(item.id)).map((item) => (
                    <div key={item.id} className="flex items-center">{item.node}</div>
                  ))}
                </div>
              )}>
                {({ open, togglePanel }) => (
                  <UiFieldTrigger
                    appearance="quiet"
                    open={open}
                    aria-label={status ? `${label} ${status}` : label}
                    aria-expanded={open}
                    onClick={togglePanel}
                    data-panel-trigger-button
                  >
                    <span className="text-text2">{label}</span>
                    {status && <span className="ml-1.5 text-text1">{status}</span>}
                  </UiFieldTrigger>
                )}
              </PanelTrigger>
            )
          }}
        />
      }
    >
      {surfaceSwitch}
      <UiSegmented ariaLabel={t('logsWindow.toolbar.mode.live')} value={mode} onChange={onModeChange} options={[{ value: 'live', label: t('logsWindow.toolbar.mode.live') }, { value: 'history', label: t('logsWindow.toolbar.mode.history') }]} />
    </UiToolbar>
  )
}
