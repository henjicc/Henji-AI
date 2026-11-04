import { UiSpinner } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { Virtuoso } from 'react-virtuoso'
import { Activity, AlertTriangle, Check, CheckCircle2, CircleDollarSign, Copy, Layers, ListChecks, MessageSquare, MessageSquareText, Route, ScrollText, Sparkles, Wrench, type LucideIcon } from 'lucide-react'

import { UiButton, UiEmpty, UiIconButton, UiLoading, UiNavButton, UI_INSET_SURFACE_CLASS } from '@/components/ui'
import { formatChainDuration, type AssistantChain, type AssistantChainStatus, type AssistantChainStep, type AssistantChainStepKind } from '@/core/assistant/assistantChain'
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
  /** 选中运行的完整链路（内置助手）；其他运行只列模型轮次。 */
  chain: AssistantChain | null
  selectedChainStepId: string
  onSelectChainStep: (step: AssistantChainStep) => void
  chainCopied: boolean
  onCopyChain: () => void
  onViewRunLogs: (run: AgentTraceRunSummary) => void
}

export function AssistantTraceList({
  runs,
  selectedTraceId,
  onSelectTrace,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  chain,
  selectedChainStepId,
  onSelectChainStep,
  chainCopied,
  onCopyChain,
  onViewRunLogs,
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
            <RunCard run={run} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace}
              chain={chain?.runId === run.runId ? chain : null} selectedChainStepId={selectedChainStepId} onSelectChainStep={onSelectChainStep}
              chainCopied={chainCopied} onCopyChain={onCopyChain} onViewRunLogs={() => onViewRunLogs(run)} />
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
  chain,
  selectedChainStepId,
  onSelectChainStep,
  chainCopied,
  onCopyChain,
  onViewRunLogs,
}: {
  run: AgentTraceRunSummary
  selectedTraceId: string
  onSelectTrace: (traceId: string) => void
  chain: AssistantChain | null
  selectedChainStepId: string
  onSelectChainStep: (step: AssistantChainStep) => void
  chainCopied: boolean
  onCopyChain: () => void
  onViewRunLogs: () => void
}): JSX.Element {
  const selected = run.steps.some((step) => step.traceId === selectedTraceId) || Boolean(chain)
  // 链路里没有对应步骤的追踪记录（准备阶段失败、日志缺失的轮次）仍列在后面
  const linked = new Set(chain?.steps.flatMap((step) => step.traceId ? [step.traceId] : []))
  const unlinked = chain ? run.steps.filter((step) => !linked.has(step.traceId)) : run.steps
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
          <div className="flex shrink-0 items-center gap-0.5">
            {selected && chain ? (
              <UiIconButton type="button" size="xs" onClick={onCopyChain} tooltip="复制完整链路（与 logs:query --chain 相同）" aria-label="复制完整链路">
                {chainCopied ? <Check /> : <Copy />}
              </UiIconButton>
            ) : null}
            {selected ? (
              <UiIconButton type="button" size="xs" onClick={onViewRunLogs} tooltip="查看这次运行的日志" aria-label="查看这次运行的日志"><ScrollText /></UiIconButton>
            ) : null}
            <StatusMark status={run.status} />
          </div>
        </div>
      </div>
      <div className="space-y-1 p-1.5">
        {chain ? chain.steps.map((step) => (
          <div key={step.id} className={step.nested ? 'pl-5' : undefined}>
            <ChainStepButton step={step} selected={selectedChainStepId === step.id || Boolean(step.traceId && !selectedChainStepId && step.traceId === selectedTraceId)} onSelect={() => onSelectChainStep(step)} />
          </div>
        )) : null}
        {unlinked.map((step) => (
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

const CHAIN_ICON: Record<AssistantChainStepKind, LucideIcon> = {
  input: MessageSquare, context: Layers, model: Sparkles, tool: Wrench, transaction: ListChecks, reply: MessageSquareText,
}
const CHAIN_STATUS_DOT: Record<AssistantChainStatus, AgentTraceStatus> = { running: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled' }

/** 链路里的一步；失败整行转危险色，付费工具带标记。 */
function ChainStepButton({ step, selected, onSelect }: { step: AssistantChainStep; selected: boolean; onSelect: () => void }): JSX.Element {
  const Icon = CHAIN_ICON[step.kind]
  const failed = step.status === 'failed'
  return (
    <UiNavButton type="button" active={selected} size="auto" className="items-center justify-start font-normal" onClick={onSelect}>
      {step.status === 'running'
        ? <span className="mr-2 flex shrink-0"><UiSpinner size="sm" tone="accent" /></span>
        : <Icon className={`${UI_ICON_SIZE_CLASS.sm} mr-2 shrink-0 ${failed ? 'text-danger-text' : 'text-accent'}`} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className={`truncate text-2xs font-medium ${failed ? 'text-danger-text' : 'text-text1'}`}>{step.title}</span>
          {step.paid ? <span className="flex shrink-0 items-center gap-0.5 text-2xs text-warning-text"><CircleDollarSign className={UI_ICON_SIZE_CLASS.xs} />付费</span> : null}
          <span className="ml-auto shrink-0 font-mono text-2xs text-text2">{step.status === 'running' ? '进行中' : formatChainDuration(step.durationMs)}</span>
        </div>
        <div className={`mt-1 truncate whitespace-nowrap text-2xs ${failed ? 'text-danger-text' : 'text-text2'}`}>{step.summary}</div>
      </div>
      <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(CHAIN_STATUS_DOT[step.status])}`} />
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
