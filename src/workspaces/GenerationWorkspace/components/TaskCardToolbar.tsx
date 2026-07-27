import { FolderCheck, FolderPlus, RefreshCw, SquarePen, Trash2 } from 'lucide-react'
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
        <RefreshCw className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton
        onClick={onReedit}
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('ui:workspace.actions.reedit')}
      >
        <SquarePen className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton
        onClick={() => void onDelete()}
        hoverVariant="danger"
        showBorder={false}
        appearance="hover-only"
        className="!h-8 !w-8"
        title={t('common:delete')}
      >
        <Trash2 className="h-4 w-4" />
      </UiIconButton>
    </div>
  )
}
