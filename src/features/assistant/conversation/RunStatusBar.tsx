import { CirclePause, CirclePlay, RotateCw, Square } from 'lucide-react'

import { UI_TEXT_META_CLASS, UI_TEXT_SECTION_CLASS, UiButton } from '@/components/ui'
import type { AgentEvent, AgentRunState } from '@/core/assistant/events'

const statusLabels: Record<AgentRunState['status'], string> = {
  initializing: '初始化',
  running: '执行中',
  waiting_tool: '等待工具',
  waiting_approval: '等待审批',
  waiting_user: '等待你的回答',
  waiting_external: '等待生成结果',
  paused: '已在安全点暂停',
  completed: '已结束',
  failed: '失败',
  cancelled: '已取消',
}

interface RunStatusBarProps {
  state: AgentRunState
  events: AgentEvent[]
  currentAction: string
  verificationPassed: boolean | null
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onRefresh: () => void
}

export function RunStatusBar({
  state,
  events,
  currentAction,
  verificationPassed,
  onPause,
  onResume,
  onCancel,
  onRefresh,
}: RunStatusBarProps): JSX.Element {
  const active = !['completed', 'failed', 'cancelled', 'waiting_external'].includes(state.status)
  const usage = state.usage
  const modelUsage = events.reduce((total, event) => (
    event.type === 'ModelCompleted' ? total + (event.usage.totalTokens ?? 0) : total
  ), 0)
  const toolCalls = new Set(events.flatMap((event) => (
    event.type === 'ToolRequested' ? [event.toolCallId] : []
  ))).size
  const continuation = events.find((event) => event.type === 'ExternalWaitResumed')
  const cumulativeTokens = usage.totalTokens
    + (continuation?.type === 'ExternalWaitResumed' ? continuation.sourceTotalTokens : 0)
  const cumulativeCost = continuation?.type === 'ExternalWaitResumed'
    ? continuation.sourceKnownCostUsd !== null && usage.knownCostUsd !== null
      ? continuation.sourceKnownCostUsd + usage.knownCostUsd
      : null
    : usage.knownCostUsd
  const elapsedMs = active
    ? Math.max(usage.elapsedMs, Date.now() - Date.parse(state.startedAt))
    : usage.elapsedMs
  return (
    <div className="border-b border-border-dark bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse bg-accent' : 'bg-text-muted'}`} />
        <span className={UI_TEXT_SECTION_CLASS}>{statusLabels[state.status]}</span>
        <span className={`min-w-0 flex-1 truncate ${UI_TEXT_META_CLASS}`} title={currentAction}>{currentAction}</span>
        {state.status === 'paused' ? (
          <UiButton type="button" size="sm" variant="ghost" title="继续" aria-label="继续" onClick={onResume} className="!h-7 !w-7 !p-0"><CirclePlay className="h-3.5 w-3.5" /></UiButton>
        ) : active ? (
          <UiButton type="button" size="sm" variant="ghost" title="当前模型或工具单元结束后安全暂停" aria-label="安全暂停" onClick={onPause} className="!h-7 !w-7 !p-0"><CirclePause className="h-3.5 w-3.5" /></UiButton>
        ) : (
          <UiButton type="button" size="sm" variant="ghost" title="刷新" aria-label="刷新" onClick={onRefresh} className="!h-7 !w-7 !p-0"><RotateCw className="h-3.5 w-3.5" /></UiButton>
        )}
        {active ? (
          <UiButton type="button" size="sm" variant="muted" title="取消" aria-label="取消" onClick={onCancel} className="!h-7 !w-7 !p-0 text-danger"><Square className="h-3.5 w-3.5" /></UiButton>
        ) : null}
      </div>
      <div className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-1 ${UI_TEXT_META_CLASS}`}>
        <span>轮次 {Math.max(usage.turns, state.turn)}/{state.budget.maxTurns}</span>
        <span>工具 {Math.max(usage.toolCalls, toolCalls)}/{state.budget.maxToolCalls}</span>
        <span>{continuation ? '累计 ' : ''}Token {Math.max(cumulativeTokens, modelUsage).toLocaleString()}</span>
        <span>{Math.round(elapsedMs / 1000)} 秒</span>
        <span>{continuation ? '累计' : ''}费用 {cumulativeCost === null ? '未知' : `$${cumulativeCost.toFixed(4)}`}</span>
        {verificationPassed !== null ? <span>{verificationPassed ? '结果已验证' : '结果待验证'}</span> : null}
      </div>
    </div>
  )
}
