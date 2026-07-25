import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { MenuItem } from '@/hooks/useContextMenu'
import type { GenerationTask } from '../types'
import TaskCard from './TaskCard'

export interface TaskListProps {
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
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string, trimRange?: { start: number; end: number }) => void
  notify: (message: string, type?: 'success' | 'error') => void
}

export function TaskList({
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
  onOpenImageViewer,
  onOpenVideoViewer,
  notify,
}: TaskListProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="max-w-6xl mx-auto w-[90%] space-y-6">
      <div className="mb-4">
        <div>
          <h2 className="text-xl font-bold">{t('history:title')}</h2>
          <p className="mt-1 text-xs text-zinc-400">
            {t('ui:workspaceFilters.resultsCount', { matched: matchedCount, total: totalCount })}
          </p>
        </div>
      </div>
      {totalCount === 0 && (
        <div className="py-20 text-center text-zinc-500">
          {t('history:empty')}
        </div>
      )}
      {tasks.length === 0 && hasActiveFilters && (
        <div className="rounded-xl border border-border-dark bg-surface-dark px-6 py-12 text-center">
          <p className="text-sm text-zinc-300">{t('ui:workspaceFilters.emptyFiltered')}</p>
        </div>
      )}
      {tasks.length > 0 && tasks.map((task) => {
        return (
          <TaskCard
            key={task.id}
            task={task}
            showMenu={showMenu}
            onDownload={onDownload}
            onCopyImage={onCopyImage}
            onRegenerate={onRegenerate}
            onRetryPolling={onRetryPolling}
            onReedit={onReedit}
            onDelete={onDelete}
            onUsePrompt={onUsePrompt}
            onOpenImageViewer={onOpenImageViewer}
            onOpenVideoViewer={onOpenVideoViewer}
            notify={notify}
          />
        )
      })}
    </div>
  )
}
