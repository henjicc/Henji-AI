import { History, MessageSquareText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { listAgentThreads } from '@/commands/assistant'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiEmpty,
  UiError,
  UiIconButton,
  UiLoading,
} from '@/components/ui'
import type { AgentThreadSummary } from '@/core/assistant/session'

import { useAssistantUiStore } from '../store/assistantUiStore'

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
  const [threads, setThreads] = useState<AgentThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setThreads(await listAgentThreads(50))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取运行历史失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openThread = (thread: AgentThreadSummary): void => {
    setThreadId(thread.threadId)
    setActiveRun(thread.lastRunId, thread.lastRunGoal)
    onOpenConversation()
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark px-3">
        <History className="h-3.5 w-3.5 text-accent" />
        <span className={`flex-1 ${UI_TEXT_SECTION_CLASS}`}>对话历史</span>
        <UiIconButton
          type="button"
          title="刷新对话历史"
          onClick={() => void refresh()}
          appearance="hover-only"
          showBorder={false}
          className="!h-8 !w-8"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </UiIconButton>
      </div>

      <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto [contain:layout_paint_style]">
        {loading && threads.length === 0 ? (
          <UiLoading size="sm" message="正在读取" />
        ) : null}

        {!loading && threads.length === 0 ? (
          <UiEmpty size="sm" title="还没有对话记录" />
        ) : null}

        {threads.map((thread) => (
          <div
            key={thread.threadId}
            className="group flex min-h-[56px] items-stretch border-b border-border-dark [content-visibility:auto] [contain-intrinsic-size:auto_56px] last:border-b-0"
          >
            <UiButton
              type="button"
              variant="ghost"
              onClick={() => openThread(thread)}
              title="打开此持续对话"
              className="min-w-0 flex-1 justify-start !rounded-none !border-0 !bg-transparent !px-3 !py-2 text-left hover:!bg-surface-dark"
            >
              <MessageSquareText className="mr-2 h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className={`w-full truncate ${UI_TEXT_BODY_CLASS}`}>{thread.title || '未命名对话'}</span>
                <span className={`w-full truncate font-normal ${UI_TEXT_META_CLASS}`}>
                  {formatTime(thread.updatedAt)} · {thread.messageCount} 条记录
                </span>
              </span>
            </UiButton>
          </div>
        ))}

        {error ? (
          <UiError size="xs" className="m-3" message={error} />
        ) : null}
      </div>
    </section>
  )
}
