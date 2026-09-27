import React, { useCallback, useRef } from 'react'
import { History } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { MenuItem } from '@/hooks/useContextMenu'
import { UiEmpty, UiPageHeader, UiRegion } from '@/components/ui'
import type { GenerationTask, ResultImageDimensions } from '../types'
import TaskCard, { type TaskCardProps } from './TaskCard'
import { TaskListRetentionContext, type TaskListRetention } from '../hooks/useTaskListRetention'
import { useVirtualTaskList } from '../hooks/useVirtualTaskList'

export interface TaskListProps {
  scrollContainerRef: React.RefObject<HTMLDivElement>
  tasks: GenerationTask[]
  totalCount: number
  matchedCount: number
  hasActiveFilters: boolean
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
  onDownload: (filePath: string, fromButton?: boolean) => Promise<void>
  onCopyImage: (filePath?: string) => Promise<void>
  onRegenerate: (task: GenerationTask) => Promise<void>
  onRetryPolling: (task: GenerationTask) => Promise<void>
  onReedit: (task: GenerationTask) => void
  onDelete: (taskId: string) => Promise<void>
  onUsePrompt: (prompt: string) => void
  onRememberResultImageDimensions: (
    taskId: string,
    imageIndex: number,
    dimensions: ResultImageDimensions
  ) => void
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string, trimRange?: { start: number; end: number }) => void
  notify: (message: string, type?: 'success' | 'error') => void
}

export function TaskList({
  scrollContainerRef,
  tasks,
  totalCount,
  matchedCount,
  hasActiveFilters,
  showMenu,
  onDownload,
  onCopyImage,
  onRegenerate,
  onRetryPolling,
  onReedit,
  onDelete,
  onUsePrompt,
  onRememberResultImageDimensions,
  onOpenImageViewer,
  onOpenVideoViewer,
  notify,
}: TaskListProps): JSX.Element {
  const { t } = useI18n()
  const { listRef, retention, virtualizer, scrollMargin } = useVirtualTaskList(tasks, scrollContainerRef)
  const taskIdAt = (target: EventTarget | null) => target instanceof Element
    ? target.closest<HTMLElement>('[data-generation-task-id]')?.dataset.generationTaskId
    : undefined
  const rememberAudio = (event: React.SyntheticEvent) => {
    const id = taskIdAt(event.target)
    if (id && event.target instanceof HTMLAudioElement) retention.rememberAudio(id, event.target)
  }

  return (
    <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto space-y-6">
      <UiPageHeader
        title={t('history:title')}
        description={t('ui:workspaceFilters.resultsCount', { matched: matchedCount, total: totalCount })}
      />
      {totalCount === 0 && (
        <UiEmpty
          icon={<History className="h-10 w-10" />}
          title={t('history:empty')}
          description={t('history:emptyHint')}
        />
      )}
      {tasks.length === 0 && totalCount > 0 && hasActiveFilters && (
        <UiEmpty title={t('ui:workspaceFilters.emptyFiltered')} />
      )}
      <TaskListRetentionContext.Provider value={retention}>
      {tasks.length > 0 && <div
        ref={listRef}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize(), overflowAnchor: 'none' }}
        onFocusCapture={(event) => {
          retention.clearReason('focus')
          const id = taskIdAt(event.target)
          if (id) retention.setActive(id, 'focus', true)
        }}
        onBlurCapture={(event) => {
          if (taskIdAt(event.relatedTarget) !== taskIdAt(event.target)) retention.clearReason('focus')
        }}
        onMouseDownCapture={(event) => {
          retention.clearReason('pointer')
          const id = taskIdAt(event.target)
          if (id) retention.setActive(id, 'pointer', true)
        }}
        onContextMenuCapture={(event) => {
          retention.clearReason('context')
          const id = taskIdAt(event.target)
          if (id) retention.setActive(id, 'context', true)
        }}
        onTimeUpdateCapture={rememberAudio}
        onVolumeChangeCapture={rememberAudio}
        onPauseCapture={rememberAudio}
      >{virtualizer.getVirtualItems().map((row) => {
        const task = tasks[row.index]
        return <TaskListRow
            key={task.id}
            index={row.index}
            top={row.start - scrollMargin}
            measure={virtualizer.measureElement}
            retention={retention}
            task={task}
            showMenu={showMenu}
            onDownload={onDownload}
            onCopyImage={onCopyImage}
            onRegenerate={onRegenerate}
            onRetryPolling={onRetryPolling}
            onReedit={onReedit}
            onDelete={onDelete}
            onUsePrompt={onUsePrompt}
            onRememberResultImageDimensions={onRememberResultImageDimensions}
            onOpenImageViewer={onOpenImageViewer}
            onOpenVideoViewer={onOpenVideoViewer}
            notify={notify}
          />
      })}</div>}
      </TaskListRetentionContext.Provider>
    </UiRegion>
  )
}

function TaskListRow({ index, top, measure, retention, ...props }: TaskCardProps & {
  index: number
  top: number
  measure: (element: HTMLDivElement | null) => void
  retention: TaskListRetention
}): JSX.Element {
  const previous = useRef<HTMLDivElement | null>(null)
  const id = props.task.id
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) previous.current?.querySelectorAll('audio').forEach(audio => retention.rememberAudio(id, audio))
    previous.current = element
    measure(element)
  }, [id, measure, retention])
  return <div ref={ref} data-index={index} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${top}px)` }}>
    <TaskCard {...props} />
  </div>
}
