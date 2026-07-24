import { Virtuoso } from 'react-virtuoso'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Route, Sparkles } from 'lucide-react'

import { UiButton } from '@/components/ui'
import type { AgentTraceRunSummary, AgentTraceStatus, AgentTraceStepSummary } from '@/core/assistant/trace'
import { compactId } from '../eventDisplay'
import { formatTraceDuration, formatTraceTokens, getTraceStepLabel } from '../assistantTraceUtils'

interface AssistantTraceListProps {
  runs: AgentTraceRunSummary[]
  selectedTraceId: string
  onSelectTrace: (traceId: string) => void
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

export function AssistantTraceList({
  runs,
  selectedTraceId,
  onSelectTrace,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: AssistantTraceListProps): JSX.Element {
  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border-dark/50 bg-black/20 p-6 text-center text-xs text-text-muted">
        {loading ? '正在读取助手追踪…' : '暂无助手模型请求记录'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border-dark/50 bg-black/20">
      <Virtuoso
        className="min-h-0 flex-1"
        data={runs}
        endReached={() => {
          if (hasMore && !loadingMore) onLoadMore()
        }}
        itemContent={(_, run) => (
          <div className="border-b border-border-dark/30 p-2 last:border-b-0">
            <RunCard run={run} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace} />
          </div>
        )}
      />
      {hasMore && (
        <div className="shrink-0 border-t border-border-dark/35 p-2">
          <UiButton
            type="button"
            size="sm"
            variant="ghost"
            className="w-full"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? '正在加载…' : '加载更早的追踪'}
          </UiButton>
        </div>
      )}
    </div>
  )
}

function RunCard({
  run,
  selectedTraceId,
  onSelectTrace,
}: {
  run: AgentTraceRunSummary
  selectedTraceId: string
  onSelectTrace: (traceId: string) => void
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border-dark/40 bg-panel/35">
      <div className="border-b border-border-dark/30 px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-text-dark">
              {run.goal?.trim() || `运行 ${compactId(run.runId)}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-text-muted">
              <span>{compactId(run.runId)}</span>
              <span>{run.requestCount} 次请求</span>
              <span>{formatTraceTokens(run.usage.totalTokens)} tok</span>
              <span>{formatTraceDuration(run.totalElapsedMs)}</span>
            </div>
          </div>
          <StatusMark status={run.status} />
        </div>
      </div>
      <div className="space-y-1 p-1.5">
        {run.steps.map((step) => (
          <TraceStepButton
            key={step.traceId}
            step={step}
            selected={selectedTraceId === step.traceId}
            onSelect={() => onSelectTrace(step.traceId)}
          />
        ))}
      </div>
    </div>
  )
}

function TraceStepButton({
  step,
  selected,
  onSelect,
}: {
  step: AgentTraceStepSummary
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const Icon = step.kind === 'router' ? Route : step.kind === 'primary' ? Sparkles : Activity
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="sm"
      className={`h-auto w-full justify-start rounded-md px-2 py-2 text-left font-normal ${
        selected ? '!border-accent/60 !bg-accent/10' : '!border-transparent !bg-transparent hover:!bg-white/5'
      }`}
      onClick={onSelect}
    >
      <Icon className="mr-2 h-3.5 w-3.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-text-dark">{getTraceStepLabel(step)}</span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted">
            {formatTraceDuration(step.elapsedMs)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
          <span className="truncate">{step.providerId} · {step.modelId}</span>
          <span className="shrink-0 font-mono">{formatTraceTokens(step.usage.totalTokens)} tok</span>
        </div>
      </div>
      <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(step.status)}`} />
    </UiButton>
  )
}

function StatusMark({ status }: { status: AgentTraceStatus }): JSX.Element {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
  if (status === 'running') return <Clock3 className="h-4 w-4 shrink-0 animate-pulse text-sky-400" />
  return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
}

function statusDot(status: AgentTraceStatus): string {
  if (status === 'completed') return 'bg-emerald-400'
  if (status === 'running') return 'bg-sky-400'
  if (status === 'failed') return 'bg-red-400'
  if (status === 'cancelled') return 'bg-amber-400'
  return 'bg-zinc-400'
}
