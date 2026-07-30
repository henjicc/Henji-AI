import { History, ListChecks, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

import { deleteAgentThreads, listAgentThreads } from '@/commands/assistant'
import ContextMenu from '@/components/ContextMenu'
import {
  AlertDialog,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiCheckbox,
  UiEmpty,
  UiError,
  UiIconButton,
} from '@/components/ui'
import type { AgentThreadSummary } from '@/core/assistant/session'
import { useContextMenu } from '@/hooks/useContextMenu'

import { useAssistantUiStore } from '../store/assistantUiStore'

interface AssistantRunHistoryProps {
  visible: boolean
  onOpenConversation: () => void
}

export function AssistantRunHistory({
  visible,
  onOpenConversation,
}: AssistantRunHistoryProps): JSX.Element {
  const setActiveRun = useAssistantUiStore((state) => state.setActiveRun)
  const setThreadId = useAssistantUiStore((state) => state.setThreadId)
  const currentThreadId = useAssistantUiStore((state) => state.threadId)
  const startNewConversation = useAssistantUiStore((state) => state.startNewConversation)
  const [threads, setThreads] = useState<AgentThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<AgentThreadSummary[]>([])
  const {
    menuVisible,
    menuPosition,
    menuItems,
    showMenu,
    hideMenu,
  } = useContextMenu()

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const nextThreads = await listAgentThreads(50)
      const nextThreadIds = new Set(nextThreads.map((thread) => thread.threadId))
      setThreads(nextThreads)
      setSelectedThreadIds((selected) => (
        new Set([...selected].filter((threadId) => nextThreadIds.has(threadId)))
      ))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取运行历史失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (visible) return
    hideMenu()
    setPendingDelete([])
  }, [hideMenu, visible])

  const openThread = (thread: AgentThreadSummary): void => {
    setThreadId(thread.threadId)
    setActiveRun(thread.lastRunId, thread.lastRunGoal)
    onOpenConversation()
  }

  const exitSelection = (): void => {
    setSelectionMode(false)
    setSelectedThreadIds(new Set())
  }

  const enterSelection = (threadId: string): void => {
    setSelectionMode(true)
    setSelectedThreadIds((selected) => {
      const next = new Set(selected)
      next.add(threadId)
      return next
    })
  }

  const toggleThread = (threadId: string): void => {
    setSelectedThreadIds((selected) => {
      const next = new Set(selected)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }

  const selectedThreads = useMemo(() => (
    threads.filter((thread) => selectedThreadIds.has(thread.threadId))
  ), [selectedThreadIds, threads])
  const allSelected = threads.length > 0 && selectedThreadIds.size === threads.length

  const toggleSelectAll = (): void => {
    setSelectedThreadIds(allSelected
      ? new Set()
      : new Set(threads.map((thread) => thread.threadId)))
  }

  const showThreadMenu = (
    event: MouseEvent<HTMLDivElement>,
    thread: AgentThreadSummary
  ): void => {
    showMenu(event, [
      {
        id: 'select',
        label: '多选',
        icon: <ListChecks />,
        onClick: () => enterSelection(thread.threadId),
      },
      {
        id: 'delete',
        label: '删除',
        icon: <Trash2 />,
        onClick: () => setPendingDelete([thread]),
      },
    ])
  }

  const confirmDelete = async (): Promise<void> => {
    const targets = pendingDelete
    if (targets.length === 0 || deleting) return
    setPendingDelete([])
    setDeleting(true)
    setError(null)
    try {
      const result = await deleteAgentThreads(targets.map((thread) => thread.threadId))
      const deletedIds = new Set(result.deletedThreadIds)
      setThreads((current) => current.filter((thread) => !deletedIds.has(thread.threadId)))
      if (deletedIds.has(currentThreadId)) startNewConversation()

      if (result.activeThreadIds.length > 0) {
        setError('正在执行或等待结果的对话不能删除，请先停止任务。')
        if (selectionMode) {
          setSelectedThreadIds(new Set(result.activeThreadIds))
        }
      } else if (selectionMode) {
        exitSelection()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除对话失败')
    } finally {
      setDeleting(false)
    }
  }

  const deleteDialogTitle = pendingDelete.length > 1
    ? `删除 ${pendingDelete.length} 个对话？`
    : '删除这个对话？'

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark px-3">
        {selectionMode ? (
          <>
            <UiIconButton
              type="button"
              title="退出多选"
              aria-label="退出多选"
              onClick={exitSelection}
              appearance="hover-only"
              showBorder={false}
              className="!h-8 !w-8"
            >
              <X className="h-3.5 w-3.5" />
            </UiIconButton>
            <span aria-live="polite" className={`min-w-0 flex-1 ${UI_TEXT_SECTION_CLASS}`}>
              已选择 {selectedThreadIds.size} 项
            </span>
            <UiButton
              type="button"
              variant="plain"
              size="sm"
              onClick={toggleSelectAll}
              disabled={threads.length === 0 || deleting}
              className="!h-8 !px-2"
            >
              {allSelected ? '取消全选' : '全选'}
            </UiButton>
            <UiIconButton
              type="button"
              title="删除所选对话"
              aria-label="删除所选对话"
              onClick={() => setPendingDelete(selectedThreads)}
              appearance="hover-only"
              hoverVariant="danger"
              showBorder={false}
              className="!h-8 !w-8"
              disabled={selectedThreadIds.size === 0 || deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </UiIconButton>
          </>
        ) : (
          <>
            <History className="h-3.5 w-3.5 text-accent" />
            <span className={`flex-1 ${UI_TEXT_SECTION_CLASS}`}>对话历史</span>
            <UiIconButton
              type="button"
              title="刷新对话历史"
              aria-label="刷新对话历史"
              onClick={() => void refresh()}
              appearance="hover-only"
              showBorder={false}
              className="!h-8 !w-8"
              disabled={loading || deleting}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </UiIconButton>
          </>
        )}
      </div>

      <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto [contain:layout_paint_style]">
        {!loading && threads.length === 0 ? (
          <UiEmpty size="sm" title="还没有对话记录" />
        ) : null}

        <div className="space-y-1 py-1">
          {threads.map((thread) => (
            <div
              key={thread.threadId}
              onContextMenu={(event) => showThreadMenu(event, thread)}
              className={`group flex items-center [content-visibility:auto] [contain-intrinsic-size:auto_32px] ${
                selectedThreadIds.has(thread.threadId) ? 'bg-surface-dark' : ''
              }`}
            >
              {selectionMode ? (
                <UiCheckbox
                  checked={selectedThreadIds.has(thread.threadId)}
                  onCheckedChange={() => toggleThread(thread.threadId)}
                  aria-label={`选择对话：${thread.title || '未命名对话'}`}
                  className="ml-3 shrink-0"
                />
              ) : null}
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => (
                  selectionMode ? toggleThread(thread.threadId) : openThread(thread)
                )}
                title={selectionMode ? '选择此对话' : '打开此持续对话'}
                className={`min-w-0 flex-1 justify-start !rounded-none !border-0 !bg-transparent text-left hover:!bg-surface-dark ${
                  selectionMode ? '!pl-2 !pr-3' : '!px-3'
                }`}
              >
                <span className={`w-full truncate ${UI_TEXT_BODY_CLASS}`}>
                  {thread.title || '未命名对话'}
                </span>
              </UiButton>
            </div>
          ))}
        </div>

        {error ? (
          <UiError size="xs" className="m-3" message={error} />
        ) : null}
      </div>

      {createPortal(
        <ContextMenu
          items={menuItems}
          position={menuPosition}
          visible={menuVisible}
          onClose={hideMenu}
        />,
        document.body
      )}

      <AlertDialog
        isOpen={pendingDelete.length > 0}
        title={deleteDialogTitle}
        message="删除后无法恢复。"
        type="warning"
        scope="container"
        closeLabel="取消"
        onClose={() => setPendingDelete([])}
        actions={[{
          label: pendingDelete.length > 1 ? `删除 ${pendingDelete.length} 项` : '删除',
          variant: 'muted',
          tone: 'danger',
          onClick: () => void confirmDelete(),
        }]}
      />
    </section>
  )
}
