import type { ReactNode } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { UiCheckbox, UiIconButton, UiSearchInput, UiOptionButton, UiSelect, UiToolbar, UI_SEGMENTED_TRACK_CLASS } from '@/components/ui'
import type { AgentTraceCaptureMode, AgentTraceStatus } from '@/core/assistant/trace'

export type AssistantTraceViewMode = 'live' | 'history'
export type AssistantTraceStatusFilter = 'all' | AgentTraceStatus

interface AssistantTraceToolbarProps {
  /** 日志窗口顶层的“事件日志 / 助手追踪”切换，放在命令带最左端（任务 5.7）。 */
  surfaceSwitch: ReactNode
  mode: AssistantTraceViewMode
  onModeChange: (mode: AssistantTraceViewMode) => void
  keyword: string
  onKeywordChange: (value: string) => void
  providerId: string
  onProviderChange: (value: string) => void
  modelId: string
  onModelChange: (value: string) => void
  status: AssistantTraceStatusFilter
  onStatusChange: (value: AssistantTraceStatusFilter) => void
  providers: string[]
  models: string[]
  historyDates: string[]
  selectedDate: string
  onDateChange: (value: string) => void
  captureMode: AgentTraceCaptureMode
  onCaptureModeChange: (mode: AgentTraceCaptureMode) => void
  onRefresh: () => void
  onClear: () => void
}

/** 骨架与事件日志相同：命令带（视图切换、实时/历史、详细追踪、刷新、清空）+ 从属带（过滤条件），任务 5.7。 */
export function AssistantTraceToolbar({
  surfaceSwitch,
  mode,
  onModeChange,
  keyword,
  onKeywordChange,
  providerId,
  onProviderChange,
  modelId,
  onModelChange,
  status,
  onStatusChange,
  providers,
  models,
  historyDates,
  selectedDate,
  onDateChange,
  captureMode,
  onCaptureModeChange,
  onRefresh,
  onClear,
}: AssistantTraceToolbarProps): JSX.Element {
  return (
    <UiToolbar
      variant="command"
      trailing={
        <>
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2" title="完整上下文只保存在本机，并自动脱敏">
            <UiCheckbox checked={captureMode === 'detailed'} onCheckedChange={(checked) => onCaptureModeChange(checked ? 'detailed' : 'summary')} />
            助手详细追踪
          </label>
          <UiIconButton type="button" onClick={onRefresh} title="刷新" aria-label="刷新"><RefreshCw className="h-4 w-4" /></UiIconButton>
          <UiIconButton type="button" tone="danger" onClick={onClear} title="清空助手追踪" aria-label="清空助手追踪"><Trash2 className="h-4 w-4" /></UiIconButton>
        </>
      }
      subordinate={
        <>
          <UiSearchInput value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索目标、运行、模型或请求标识" aria-label="搜索链路" className="min-w-40 flex-1" />
          <UiSelect value={providerId} onChange={(event) => onProviderChange(event.target.value)} className="w-36">
            <option value="all">全部供应商</option>
            {providers.map((value) => <option key={value} value={value}>{value}</option>)}
          </UiSelect>
          <UiSelect value={modelId} onChange={(event) => onModelChange(event.target.value)} className="w-44">
            <option value="all">全部模型</option>
            {models.map((value) => <option key={value} value={value}>{value}</option>)}
          </UiSelect>
          <UiSelect
            value={status}
            onChange={(event) => onStatusChange(event.target.value as AssistantTraceStatusFilter)}
            className="w-28"
          >
            <option value="all">全部状态</option>
            <option value="running">运行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
            <option value="interrupted">已中断</option>
          </UiSelect>
          {mode === 'history' && (
            <UiSelect value={selectedDate} onChange={(event) => onDateChange(event.target.value)} className="w-36" disabled={historyDates.length === 0}>
              {historyDates.length === 0 ? <option value="">暂无历史</option> : historyDates.map((date) => <option key={date} value={date}>{date}</option>)}
            </UiSelect>
          )}
        </>
      }
    >
      {surfaceSwitch}
      <div className={UI_SEGMENTED_TRACK_CLASS}>
        <UiOptionButton type="button" variant="segment" active={mode === 'live'} aria-pressed={mode === 'live'} onClick={() => onModeChange('live')}>实时</UiOptionButton>
        <UiOptionButton type="button" variant="segment" active={mode === 'history'} aria-pressed={mode === 'history'} onClick={() => onModeChange('history')}>历史</UiOptionButton>
      </div>
    </UiToolbar>
  )
}
