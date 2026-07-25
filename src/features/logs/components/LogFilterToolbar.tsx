import { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { getLogCaptureMode } from '@/commands/logging'
import { useSettingsStore } from '@/stores/settingsStore'
import { UiButton, UiCheckbox, UiInput, UiSelect } from '@/components/ui'
import type { LogLevel } from '../eventDisplay'

export type SourceFilter = 'all' | 'frontend' | 'backend'
export type LevelFilter = 'all' | LogLevel
/** 实时模式：订阅内存缓冲；历史模式：从主进程按日期查询磁盘日志文件（2.3 历史日志回读）。 */
export type LogViewMode = 'live' | 'history'

const LEVEL_VALUES: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

interface LogFilterToolbarProps {
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
 */
export function LogFilterToolbar({
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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-dark/50 bg-panel/60 px-3 py-2">
      <div className="flex items-center gap-1 rounded-md border border-border-dark/50 bg-black/10 p-0.5">
        <UiButton
          type="button"
          size="sm"
          variant={mode === 'live' ? 'primary' : 'ghost'}
          onClick={() => onModeChange('live')}
        >
          {t('logsWindow.toolbar.mode.live')}
        </UiButton>
        <UiButton
          type="button"
          size="sm"
          variant={mode === 'history' ? 'primary' : 'ghost'}
          onClick={() => onModeChange('history')}
        >
          {t('logsWindow.toolbar.mode.history')}
        </UiButton>
      </div>

      <UiSelect
        value={sourceFilter}
        onChange={(event) => onSourceFilterChange(event.target.value as SourceFilter)}
        className="w-32"
      >
        <option value="all">{t('logsWindow.toolbar.source.all')}</option>
        <option value="frontend">{t('logsWindow.toolbar.source.frontend')}</option>
        <option value="backend">{t('logsWindow.toolbar.source.backend')}</option>
      </UiSelect>

      <UiSelect
        value={levelFilter}
        onChange={(event) => onLevelFilterChange(event.target.value as LevelFilter)}
        className="w-32"
      >
        <option value="all">{t('logsWindow.toolbar.level.all')}</option>
        {LEVEL_VALUES.map((level) => (
          <option key={level} value={level}>{level.toUpperCase()}</option>
        ))}
      </UiSelect>

      <UiSelect
        value={domainFilter}
        onChange={(event) => onDomainFilterChange(event.target.value)}
        className="w-44"
      >
        <option value="all">{t('logsWindow.toolbar.domain.all')}</option>
        {domainOptions.map((domain) => (
          <option key={domain} value={domain}>{domain}</option>
        ))}
      </UiSelect>

      <UiInput
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        placeholder={t('logsWindow.toolbar.keywordPlaceholder')}
        className="min-w-[220px] flex-1"
      />

      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <UiCheckbox checked={errorOnly} onCheckedChange={onErrorOnlyChange} />
        {t('logsWindow.toolbar.errorOnly')}
      </label>

      {mode === 'live' ? (
        <>
          <UiButton type="button" size="sm" variant="ghost" onClick={onTogglePause}>
            {paused ? t('logsWindow.toolbar.resume') : t('logsWindow.toolbar.pause')}
          </UiButton>
          <UiButton type="button" size="sm" variant="ghost" onClick={onClear}>
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
            <span className="text-2xs text-yellow-500/90">
              {t('logsWindow.toolbar.historyDate.corrupted', { count: historyCorruptedLines })}
            </span>
          )}
        </>
      )}

      <div className="flex items-center gap-1">
        <UiInput
          value={chainQuery}
          onChange={(event) => setChainQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleChainLookup()
            }
          }}
          placeholder={t('logsWindow.toolbar.chainLookupPlaceholder')}
          className="w-40"
        />
        <UiButton type="button" size="sm" variant="ghost" onClick={handleChainLookup}>
          {t('logsWindow.chain.viewButton')}
        </UiButton>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-text-muted" title={t('logsWindow.toolbar.captureMode.description')}>
        <UiCheckbox
          checked={captureMode === 'full'}
          onCheckedChange={(checked) => setCaptureMode(checked ? 'full' : 'standard')}
        />
        {t('logsWindow.toolbar.captureMode.title')}
      </label>
    </div>
  )
}
