import { useEffect, useMemo, useState } from 'react'

import { UiButton, UiModal } from '@/components/ui'
import {
  clearAgentTraces,
  getAgentTraceCaptureMode,
  getAgentTraceDetail,
  listLogDates,
  queryAgentTraces,
  setAgentTraceCaptureMode,
} from '@/commands/logging'
import { createLogger } from '@/core/logging'
import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQueryResult,
  AgentTraceRunSummary,
} from '@/core/assistant/trace'
import { buildAgentTraceDiff, formatTraceDuration, formatTraceTokens, type AgentTraceDiff } from '../assistantTraceUtils'
import {
  AssistantTraceToolbar,
  type AssistantTraceStatusFilter,
  type AssistantTraceViewMode,
} from './AssistantTraceToolbar'
import { AssistantTraceList } from './AssistantTraceList'
import { AssistantTraceDetail } from './AssistantTraceDetail'
import { AssistantTraceDiffDialog } from './AssistantTraceDiffDialog'

const logger = createLogger('features.logs.AssistantTracePanel')

interface AssistantTracePanelProps {
  refreshToken: number
}

export function AssistantTracePanel({ refreshToken }: AssistantTracePanelProps): JSX.Element {
  const [mode, setMode] = useState<AssistantTraceViewMode>('live')
  const [keyword, setKeyword] = useState('')
  const [providerId, setProviderId] = useState('all')
  const [modelId, setModelId] = useState('all')
  const [status, setStatus] = useState<AssistantTraceStatusFilter>('all')
  const [historyDates, setHistoryDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [captureMode, setCaptureMode] = useState<AgentTraceCaptureMode>('summary')
  const [queryResult, setQueryResult] = useState<AgentTraceQueryResult>({ runs: [], hasMore: false })
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedTraceId, setSelectedTraceId] = useState('')
  const [detail, setDetail] = useState<AgentTraceDetailResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diff, setDiff] = useState<AgentTraceDiff | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getAgentTraceCaptureMode(), listLogDates()]).then(([capture, dates]) => {
      if (cancelled) return
      setCaptureMode(capture)
      setHistoryDates(dates)
      setSelectedDate((current) => current || dates[0] || '')
    }).catch((error) => {
      logger.error('读取助手追踪配置失败', { event: 'assistant_trace.config.load.failed', error })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (mode !== 'live') return
    setRevision((value) => value + 1)
  }, [mode, refreshToken])

  useEffect(() => {
    if (mode === 'history' && !selectedDate) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setErrorMessage('')
      void queryAgentTraces({
        ...(mode === 'history' ? { date: selectedDate } : {}),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(providerId !== 'all' ? { providerId } : {}),
        ...(modelId !== 'all' ? { modelId } : {}),
        ...(status !== 'all' ? { status } : {}),
        limit: 100,
      }).then((result) => {
        if (cancelled) return
        setQueryResult(result)
      }).catch((error) => {
        logger.error('查询助手追踪失败', { event: 'assistant_trace.query.failed', error })
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : '查询助手追踪失败')
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, selectedDate, keyword, providerId, modelId, status, revision])

  const runs = queryResult.runs
  const traceIds = useMemo(() => new Set(runs.flatMap((run) => run.steps.map((step) => step.traceId))), [runs])

  useEffect(() => {
    if (selectedTraceId && traceIds.has(selectedTraceId)) return
    const latestRun = runs[0]
    const latestStep = latestRun?.steps[latestRun.steps.length - 1]
    setSelectedTraceId(latestStep?.traceId ?? '')
  }, [runs, selectedTraceId, traceIds])

  useEffect(() => {
    if (!selectedTraceId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void getAgentTraceDetail(selectedTraceId).then((result) => {
      if (!cancelled) setDetail(result)
    }).catch((error) => {
      logger.error('加载助手追踪详情失败', { event: 'assistant_trace.detail.failed', error })
      if (!cancelled) setDetail(null)
    }).finally(() => {
      if (!cancelled) setDetailLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedTraceId, revision])

  const providers = useMemo(() => unique(runs.flatMap((run) => run.steps.map((step) => step.providerId))), [runs])
  const models = useMemo(() => unique(runs.flatMap((run) => run.steps.map((step) => step.modelId))), [runs])
  const totals = useMemo(() => summarizeRuns(runs), [runs])
  const comparison = useMemo(() => findPreviousPrimaryStep(runs, selectedTraceId), [runs, selectedTraceId])

  async function handleCaptureModeChange(next: AgentTraceCaptureMode): Promise<void> {
    setCaptureMode(next)
    try {
      await setAgentTraceCaptureMode(next)
    } catch (error) {
      setCaptureMode(captureMode)
      logger.error('切换助手详细追踪失败', { event: 'assistant_trace.capture_mode.failed', error })
    }
  }

  async function handleCompare(): Promise<void> {
    if (!comparison || !detail) return
    setDiffOpen(true)
    setDiffLoading(true)
    setDiff(null)
    try {
      const previous = await getAgentTraceDetail(comparison.traceId)
      setDiff(previous ? buildAgentTraceDiff(previous, detail) : null)
    } catch (error) {
      logger.error('计算助手轮次差异失败', { event: 'assistant_trace.diff.failed', error })
    } finally {
      setDiffLoading(false)
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (!queryResult.hasMore || !queryResult.nextBeforeTimestamp || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await queryAgentTraces({
        ...(mode === 'history' ? { date: selectedDate } : {}),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(providerId !== 'all' ? { providerId } : {}),
        ...(modelId !== 'all' ? { modelId } : {}),
        ...(status !== 'all' ? { status } : {}),
        beforeTimestamp: queryResult.nextBeforeTimestamp,
        limit: 100,
      })
      setQueryResult((current) => mergeTraceQueryResults(current, next))
    } catch (error) {
      logger.error('加载更多助手追踪失败', { event: 'assistant_trace.query_more.failed', error })
      setErrorMessage(error instanceof Error ? error.message : '加载更多助手追踪失败')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleClear(): Promise<void> {
    try {
      await clearAgentTraces(mode === 'history' ? selectedDate : undefined)
      setClearConfirmOpen(false)
      setSelectedTraceId('')
      setDetail(null)
      setRevision((value) => value + 1)
    } catch (error) {
      logger.error('清空助手追踪失败', { event: 'assistant_trace.clear.failed', error })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AssistantTraceToolbar
        mode={mode}
        onModeChange={setMode}
        keyword={keyword}
        onKeywordChange={setKeyword}
        providerId={providerId}
        onProviderChange={setProviderId}
        modelId={modelId}
        onModelChange={setModelId}
        status={status}
        onStatusChange={setStatus}
        providers={providers}
        models={models}
        historyDates={historyDates}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        captureMode={captureMode}
        onCaptureModeChange={(next) => void handleCaptureModeChange(next)}
        onRefresh={() => setRevision((value) => value + 1)}
        onClear={() => setClearConfirmOpen(true)}
      />
      {captureMode === 'detailed' && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-3xs text-amber-300">
          详细追踪已开启：从下一次模型请求开始，完整提示词、消息、工具和脱敏后的 HTTP 请求会保存在本机；应用重启后自动关闭。
        </div>
      )}
      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-border-dark/35 px-3 py-2 sm:grid-cols-6 xl:grid-cols-9">
        <SummaryMetric label="请求" value={String(totals.requests)} />
        <SummaryMetric label="完成" value={String(totals.completed)} />
        <SummaryMetric label="失败" value={String(totals.failed)} />
        <SummaryMetric label="输入" value={`${formatTraceTokens(totals.input)} tok`} />
        <SummaryMetric label="输出" value={`${formatTraceTokens(totals.output)} tok`} />
        <SummaryMetric label="推理" value={`${formatTraceTokens(totals.reasoning)} tok`} />
        <SummaryMetric label="缓存" value={`${formatTraceTokens(totals.cacheRead)} tok`} />
        <SummaryMetric label="总计" value={`${formatTraceTokens(totals.total)} tok`} />
        <SummaryMetric label="耗时" value={formatTraceDuration(totals.elapsed)} />
      </div>
      {errorMessage && <div className="shrink-0 bg-red-500/10 px-3 py-1.5 text-2xs text-red-300">{errorMessage}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(180px,36%)_minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:grid-rows-1">
        <AssistantTraceList
          runs={runs}
          selectedTraceId={selectedTraceId}
          onSelectTrace={setSelectedTraceId}
          loading={loading}
          hasMore={queryResult.hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void handleLoadMore()}
        />
        <AssistantTraceDetail result={detail} loading={detailLoading} canCompare={Boolean(comparison && detail?.detail)} onCompare={() => void handleCompare()} />
      </div>

      <UiModal
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        title="清空助手追踪"
        size="compact"
        footer={<><UiButton type="button" variant="ghost" onClick={() => setClearConfirmOpen(false)}>取消</UiButton><UiButton type="button" variant="primary" onClick={() => void handleClear()}>确认清空</UiButton></>}
      >
        <div className="text-sm text-text-muted">
          {mode === 'history' ? `将删除 ${selectedDate} 的助手追踪记录。` : '将删除当前保存的全部助手追踪记录。'}此操作不会影响助手对话和普通日志。
        </div>
      </UiModal>
      <AssistantTraceDiffDialog
        isOpen={diffOpen}
        onClose={() => setDiffOpen(false)}
        title={comparison && detail ? `${comparison.stepId} → ${detail.summary.stepId}` : '相邻轮次对比'}
        diff={diff}
        loading={diffLoading}
      />
    </div>
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function mergeTraceQueryResults(
  current: AgentTraceQueryResult,
  next: AgentTraceQueryResult
): AgentTraceQueryResult {
  const runs = new Map(current.runs.map((run) => [run.runId, run]))
  for (const run of next.runs) {
    const existing = runs.get(run.runId)
    if (!existing) {
      runs.set(run.runId, run)
      continue
    }
    const steps = new Map(existing.steps.map((step) => [step.traceId, step]))
    for (const step of run.steps) steps.set(step.traceId, step)
    runs.set(run.runId, summarizeMergedRun(existing, run, [...steps.values()]))
  }
  return {
    runs: [...runs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    hasMore: next.hasMore,
    nextBeforeTimestamp: next.nextBeforeTimestamp,
  }
}

function summarizeMergedRun(
  current: AgentTraceRunSummary,
  next: AgentTraceRunSummary,
  steps: AgentTraceRunSummary['steps']
): AgentTraceRunSummary {
  const sortedSteps = steps.slice().sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  return {
    runId: current.runId,
    threadId: current.threadId ?? next.threadId,
    goal: current.goal ?? next.goal,
    status: summarizeStepStatus(sortedSteps),
    startedAt: sortedSteps[0]?.startedAt ?? current.startedAt,
    updatedAt: current.updatedAt > next.updatedAt ? current.updatedAt : next.updatedAt,
    requestCount: sortedSteps.length,
    completedCount: sortedSteps.filter((step) => step.status === 'completed').length,
    failedCount: sortedSteps.filter((step) => step.status === 'failed').length,
    totalElapsedMs: sortedSteps.reduce((total, step) => total + (step.elapsedMs ?? 0), 0),
    usage: {
      inputTokens: sumNullable(sortedSteps.map((step) => step.usage.inputTokens)),
      inputNoCacheTokens: sumNullable(sortedSteps.map((step) => step.usage.inputNoCacheTokens)),
      cacheReadTokens: sumNullable(sortedSteps.map((step) => step.usage.cacheReadTokens)),
      cacheWriteTokens: sumNullable(sortedSteps.map((step) => step.usage.cacheWriteTokens)),
      outputTokens: sumNullable(sortedSteps.map((step) => step.usage.outputTokens)),
      textTokens: sumNullable(sortedSteps.map((step) => step.usage.textTokens)),
      reasoningTokens: sumNullable(sortedSteps.map((step) => step.usage.reasoningTokens)),
      totalTokens: sumNullable(sortedSteps.map((step) => step.usage.totalTokens)),
    },
    steps: sortedSteps,
  }
}

function summarizeStepStatus(steps: AgentTraceRunSummary['steps']): AgentTraceRunSummary['status'] {
  if (steps.some((step) => step.status === 'running')) return 'running'
  if (steps.some((step) => step.status === 'failed')) return 'failed'
  if (steps.some((step) => step.status === 'cancelled')) return 'cancelled'
  if (steps.some((step) => step.status === 'interrupted')) return 'interrupted'
  return 'completed'
}

function sumNullable(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null)
  return available.length > 0 ? available.reduce((total, value) => total + value, 0) : null
}

function summarizeRuns(runs: AgentTraceRunSummary[]): {
  requests: number; completed: number; failed: number; input: number; output: number;
  reasoning: number; cacheRead: number; total: number; elapsed: number
} {
  return runs.reduce((summary, run) => ({
    requests: summary.requests + run.requestCount,
    completed: summary.completed + run.completedCount,
    failed: summary.failed + run.failedCount,
    input: summary.input + (run.usage.inputTokens ?? 0),
    output: summary.output + (run.usage.outputTokens ?? 0),
    reasoning: summary.reasoning + (run.usage.reasoningTokens ?? 0),
    cacheRead: summary.cacheRead + (run.usage.cacheReadTokens ?? 0),
    total: summary.total + (run.usage.totalTokens ?? 0),
    elapsed: summary.elapsed + run.totalElapsedMs,
  }), { requests: 0, completed: 0, failed: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0, elapsed: 0 })
}

function findPreviousPrimaryStep(runs: AgentTraceRunSummary[], traceId: string): AgentTraceRunSummary['steps'][number] | null {
  for (const run of runs) {
    const index = run.steps.findIndex((step) => step.traceId === traceId)
    if (index < 0 || run.steps[index].kind !== 'primary') continue
    const previous = run.steps.slice(0, index).reverse().find((step) => step.kind === 'primary' && step.hasDetail)
    return previous ?? null
  }
  return null
}

function SummaryMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="rounded border border-border-dark/35 bg-black/15 px-2 py-1"><div className="text-4xs uppercase tracking-wider text-text-muted">{label}</div><div className="mt-0.5 truncate font-mono text-2xs text-text-dark">{value}</div></div>
}
