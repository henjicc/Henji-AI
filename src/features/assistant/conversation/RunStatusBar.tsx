import { CirclePause, CirclePlay, RotateCw, Square } from 'lucide-react'

import { UiButton } from '@/components/ui'
import type { AgentEvent, AgentRunState } from '@/core/assistant/events'

const statusLabels: Record<AgentRunState['status'], string> = {
  initializing: '初始化',
  running: '执行中',
  waiting_tool: '等待工具',
  waiting_approval: '等待审批',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface RunStatusBarProps {
  state: AgentRunState
  events: AgentEvent[]
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onRefresh: () => void
}

export function RunStatusBar({ state, events, onPause, onResume, onCancel, onRefresh }: RunStatusBarProps): JSX.Element {
  const active = !['completed', 'failed', 'cancelled'].includes(state.status)
  const usage = state.usage
  const modelUsage = events.reduce((total, event) => (
    event.type === 'ModelCompleted' ? total + (event.usage.totalTokens ?? 0) : total
  ), 0)
  const toolCalls = new Set(events.flatMap((event) => (
    event.type === 'ToolRequested' ? [event.toolCallId] : []
  ))).size
  const elapsedMs = active
    ? Math.max(usage.elapsedMs, Date.now() - Date.parse(state.startedAt))
    : usage.elapsedMs
  return (
    <div className="border-b border-border-dark bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse bg-accent' : 'bg-text-muted'}`} />
        <span className="text-xs font-medium text-text-dark">{statusLabels[state.status]}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted">run {state.runId.slice(0, 8)}</span>
        {state.status === 'paused' ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={onResume} className="h-7 gap-1 px-2"><CirclePlay className="h-3 w-3" />继续</UiButton>
        ) : active ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={onPause} className="h-7 gap-1 px-2"><CirclePause className="h-3 w-3" />暂停</UiButton>
        ) : (
          <UiButton type="button" size="sm" variant="ghost" onClick={onRefresh} className="h-7 gap-1 px-2"><RotateCw className="h-3 w-3" />刷新</UiButton>
        )}
        {active ? (
          <UiButton type="button" size="sm" variant="muted" onClick={onCancel} className="h-7 gap-1 px-2 text-danger"><Square className="h-3 w-3" />取消</UiButton>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span>轮次 {Math.max(usage.turns, state.turn)}/{state.budget.maxTurns}</span>
        <span>工具 {Math.max(usage.toolCalls, toolCalls)}/{state.budget.maxToolCalls}</span>
        <span>Token {Math.max(usage.totalTokens, modelUsage).toLocaleString()}</span>
        <span>{Math.round(elapsedMs / 1000)} 秒</span>
        <span>费用 {usage.knownCostUsd === null ? '未知' : `$${usage.knownCostUsd.toFixed(4)}`}</span>
      </div>
    </div>
  )
}
