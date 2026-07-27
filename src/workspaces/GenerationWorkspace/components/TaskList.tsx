import React from 'react'
import { History } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { MenuItem } from '@/hooks/useContextMenu'
import { UiEmpty, UiPageHeader, UiRegion } from '@/components/ui'
import type { GenerationTask, ResultImageDimensions } from '../types'
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
            onRememberResultImageDimensions={onRememberResultImageDimensions}
            onOpenImageViewer={onOpenImageViewer}
            onOpenVideoViewer={onOpenVideoViewer}
            notify={notify}
          />
        )
      })}
    </UiRegion>
  )
}
