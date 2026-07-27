import { FolderCheck, FolderPlus } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { GenerationTask } from '../types'
import { DownloadIcon, UsePromptIcon } from './TaskActionIcons'

export interface TaskCardToolbarProps {
  task: GenerationTask
  collecting: boolean
  allResultsCollected: boolean
  onUsePrompt: () => void
  onCollectAll: () => Promise<void>
  onDownloadAll: () => Promise<void>
  onRegenerate: () => Promise<void>
  onReedit: () => void
  onDelete: () => Promise<void>
}

export function TaskCardToolbar({
  task,
  collecting,
  allResultsCollected,
  onUsePrompt,
  onCollectAll,
  onDownloadAll,
  onRegenerate,
  onReedit,
  onDelete,
}: TaskCardToolbarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="absolute right-0 top-0 flex gap-2">
      <UiIconButton
        onClick={onUsePrompt}
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('ui:workspace.actions.usePrompt')}
      >
        <UsePromptIcon className="h-4 w-4" />
      </UiIconButton>
      {task.result?.filePath && (
        <UiIconButton
          onClick={() => void onCollectAll()}
          disabled={collecting}
          showBorder={false}
          appearance="hover-only"
          className={`!h-8 !w-8 ${allResultsCollected ? '!text-emerald-400' : ''}`}
          title={t('ui:assetLibrary.collect')}
        >
          {allResultsCollected
            ? <FolderCheck className="h-4 w-4" />
            : <FolderPlus className="h-4 w-4" />}
        </UiIconButton>
      )}
      {task.result?.filePath && (
        <UiIconButton
          onClick={() => void onDownloadAll()}
          showBorder={false}
          appearance="hover-only"
          className="!h-8 !w-8"
          title={t('common:actions.download')}
        >
          <DownloadIcon className="h-4 w-4" />
        </UiIconButton>
      )}
      <UiIconButton
        onClick={() => void onRegenerate()}
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('ui:workspace.actions.regenerate')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </UiIconButton>
      <UiIconButton
        onClick={onReedit}
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('ui:workspace.actions.reedit')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </UiIconButton>
      <UiIconButton
        onClick={() => void onDelete()}
        hoverVariant="danger"
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('common:delete')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </UiIconButton>
    </div>
  )
}
