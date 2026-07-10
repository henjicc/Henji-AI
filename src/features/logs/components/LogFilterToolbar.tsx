import { useEffect } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { getLogCaptureMode } from '@/commands/logging'
import { useSettingsStore } from '@/stores/settingsStore'
import { UiButton, UiCheckbox, UiInput, UiSelect } from '@/components/ui'
import type { LogLevel } from '../eventDisplay'

export type SourceFilter = 'all' | 'frontend' | 'backend'
export type LevelFilter = 'all' | LogLevel

const LEVEL_VALUES: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

interface LogFilterToolbarProps {
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
  levelFilter: LevelFilter
  onLevelFilterChange: (value: LevelFilter) => void
  domainFilter: string
  onDomainFilterChange: (value: string) => void
  domainOptions: string[]
  keyword: string
  onKeywordChange: (value: string) => void
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
}

/**
 * 日志窗口工具栏：来源/级别/domain/关键词过滤 + 暂停恢复 + 清空 + 完整捕获开关。
 * 完整捕获开关（原挂在 TestModePanel）在此落地，交互与状态读写方式不变（见 2.1 decisions.md）。
 */
export function LogFilterToolbar({
  sourceFilter,
  onSourceFilterChange,
  levelFilter,
  onLevelFilterChange,
  domainFilter,
  onDomainFilterChange,
  domainOptions,
  keyword,
  onKeywordChange,
  paused,
  onTogglePause,
  onClear,
}: LogFilterToolbarProps): JSX.Element {
  const { t } = useI18n('ui')
  const captureMode = useSettingsStore((state) => state.logCaptureMode)
  const setCaptureMode = useSettingsStore((state) => state.setLogCaptureMode)

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

      <UiButton type="button" size="sm" variant="ghost" onClick={onTogglePause}>
        {paused ? t('logsWindow.toolbar.resume') : t('logsWindow.toolbar.pause')}
      </UiButton>
      <UiButton type="button" size="sm" variant="ghost" onClick={onClear}>
        {t('logsWindow.toolbar.clear')}
      </UiButton>

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
