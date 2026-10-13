import { UiSpinner } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { Virtuoso } from 'react-virtuoso'
import { Activity, AlertTriangle, CheckCircle2, Route, Sparkles } from 'lucide-react'

import { UiButton, UiEmpty, UiLoading, UiNavButton, UI_INSET_SURFACE_CLASS } from '@/components/ui'
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
      <div className="h-full rounded-lg bg-panel p-3">
        {loading
          ? <UiLoading className="h-full" size="sm" message="正在读取助手追踪…" />
          : <UiEmpty className="h-full" size="sm" title="暂无助手模型请求记录" />}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg bg-panel">
      <Virtuoso
        className="min-h-0 flex-1"
        data={runs}
        endReached={() => {
          if (hasMore && !loadingMore) onLoadMore()
        }}
        itemContent={(_, run) => (
          <div className="border-b border-line/30 p-2 last:border-b-0">
            <RunCard run={run} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace} />
          </div>
        )}
      />
      {hasMore && (
        <div className="shrink-0 border-t border-line/35 p-2">
          <UiButton loading={loadingMore}
            type="button"
            variant="secondary"
            className="w-full"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {'加载更早的追踪'}
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
    <div className={`overflow-hidden rounded-md ${UI_INSET_SURFACE_CLASS}`}>
      <div className="border-b border-line/30 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-text1">
              {run.goal?.trim() || `运行 ${compactId(run.runId)}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-text2">
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
    <UiNavButton
      type="button"
      active={selected}
      size="auto"
      className="items-center justify-start  font-normal"
      onClick={onSelect}
    >
      <Icon className={`${UI_ICON_SIZE_CLASS.sm} mr-2 shrink-0 text-accent`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-2xs font-medium text-text1">{getTraceStepLabel(step)}</span>
          <span className="shrink-0 font-mono text-2xs text-text2">
            {formatTraceDuration(step.elapsedMs)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-text2">
          <span className="truncate">{step.providerId} · {step.modelId}</span>
          <span className="shrink-0 font-mono">{formatTraceTokens(step.usage.totalTokens)} tok</span>
        </div>
      </div>
      <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(step.status)}`} />
    </UiNavButton>
  )
}

function StatusMark({ status }: { status: AgentTraceStatus }): JSX.Element {
  if (status === 'completed') return <CheckCircle2 className={`${UI_ICON_SIZE_CLASS.md} shrink-0 text-success-text`} />
  if (status === 'running') return <UiSpinner tone="accent" />
  return <AlertTriangle className={`${UI_ICON_SIZE_CLASS.md} shrink-0 text-warning-text`} />
}

function statusDot(status: AgentTraceStatus): string {
  if (status === 'completed') return 'bg-success-solid'
  if (status === 'running') return 'bg-accent'
  if (status === 'failed') return 'bg-danger-solid'
  if (status === 'cancelled') return 'bg-warning-solid'
  return 'bg-text2'
}
