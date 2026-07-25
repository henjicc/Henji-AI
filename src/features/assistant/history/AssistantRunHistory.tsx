import { AlertCircle, History, LoaderCircle, MessageSquareText, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { listAgentRuns, retryAgentRun } from '@/commands/assistant'
import { UiButton, UiIconButton } from '@/components/ui'
import type { AgentRunSummary } from '@/core/assistant/persistence'

import { useAssistantUiStore } from '../store/assistantUiStore'

const statusLabels: Record<AgentRunSummary['status'], string> = {
  initializing: '准备中',
  running: '运行中',
  waiting_tool: '等待工具',
  waiting_approval: '等待批准',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface AssistantRunHistoryProps {
  onOpenConversation: () => void
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function AssistantRunHistory({
  onOpenConversation,
}: AssistantRunHistoryProps): JSX.Element {
  const setActiveRun = useAssistantUiStore((state) => state.setActiveRun)
  const setThreadId = useAssistantUiStore((state) => state.setThreadId)
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setRuns(await listAgentRuns(undefined, 50))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取运行历史失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openRun = (run: AgentRunSummary): void => {
    setThreadId(run.threadId)
    setActiveRun(run.runId, run.goal)
    onOpenConversation()
  }

  const retry = async (run: AgentRunSummary): Promise<void> => {
    setRetryingRunId(run.runId)
    setError(null)
    try {
      const result = await retryAgentRun(run.runId)
      setThreadId(run.threadId)
      setActiveRun(result.runId, run.goal)
      onOpenConversation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新运行失败')
    } finally {
      setRetryingRunId(null)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark px-3">
        <History className="h-3.5 w-3.5 text-accent" />
        <span className="flex-1 text-xs font-medium text-text-dark">运行历史</span>
        <UiIconButton
          type="button"
          title="刷新运行历史"
          onClick={() => void refresh()}
          className="!h-7 !w-7 !rounded-md"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </UiIconButton>
      </div>

      <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto [contain:layout_paint_style]">
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" />正在读取
          </div>
        ) : null}

        {!loading && runs.length === 0 ? (
          <div className="py-12 text-center text-xs leading-5 text-text-muted">还没有可恢复的运行记录。</div>
        ) : null}

        {runs.map((run) => (
          <div
            key={run.runId}
            className="group flex min-h-[60px] items-stretch border-b border-border-dark [content-visibility:auto] [contain-intrinsic-size:auto_60px] last:border-b-0"
          >
            <UiButton
              type="button"
              variant="ghost"
              onClick={() => openRun(run)}
              title="打开此对话"
              className="min-w-0 flex-1 justify-start !rounded-none !border-0 !bg-transparent !px-3 !py-2 text-left hover:!bg-surface-dark"
            >
              <MessageSquareText className="mr-2 h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="w-full truncate text-xs text-text-dark">{run.goal || '未命名任务'}</span>
                <span className="w-full truncate text-[10px] font-normal text-text-muted">
                  {statusLabels[run.status]} · {formatTime(run.updatedAt)}
                  {run.recoveryStatus === 'recovery_required' ? ' · 需要确认重试' : ''}
                </span>
              </span>
            </UiButton>
            {run.canRetry ? (
              <UiIconButton
                type="button"
                title="重新运行"
                onClick={() => void retry(run)}
                className="my-auto mr-2 !h-7 !w-7 !rounded-md"
                disabled={retryingRunId !== null}
              >
                {retryingRunId === run.runId
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
              </UiIconButton>
            ) : null}
          </div>
        ))}

        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-5">{error}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
