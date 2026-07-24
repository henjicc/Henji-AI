import { RefreshCw, Trash2 } from 'lucide-react'

import { UiButton, UiCheckbox, UiInput, UiSelect } from '@/components/ui'
import type { AgentTraceCaptureMode, AgentTraceStatus } from '@/core/assistant/trace'

export type AssistantTraceViewMode = 'live' | 'history'
export type AssistantTraceStatusFilter = 'all' | AgentTraceStatus

interface AssistantTraceToolbarProps {
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

export function AssistantTraceToolbar({
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
    <div className="flex flex-wrap items-center gap-2 border-b border-border-dark/50 bg-panel/60 px-3 py-2">
      <div className="flex items-center gap-1 rounded-md border border-border-dark/50 bg-black/10 p-0.5">
        <UiButton type="button" size="sm" variant={mode === 'live' ? 'primary' : 'ghost'} onClick={() => onModeChange('live')}>实时</UiButton>
        <UiButton type="button" size="sm" variant={mode === 'history' ? 'primary' : 'ghost'} onClick={() => onModeChange('history')}>历史</UiButton>
      </div>
      <UiInput value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索目标、运行、模型或请求标识" className="min-w-[210px] flex-1" />
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
      <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="完整上下文只保存在本机，并自动脱敏">
        <UiCheckbox checked={captureMode === 'detailed'} onCheckedChange={(checked) => onCaptureModeChange(checked ? 'detailed' : 'summary')} />
        助手详细追踪
      </label>
      <UiButton type="button" size="sm" variant="ghost" onClick={onRefresh} title="刷新"><RefreshCw className="h-3.5 w-3.5" /></UiButton>
      <UiButton type="button" size="sm" variant="ghost" onClick={onClear} title="清空助手追踪"><Trash2 className="h-3.5 w-3.5" /></UiButton>
    </div>
  )
}
