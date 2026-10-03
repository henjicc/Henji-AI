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

  // 记录工具条：图标化、名称进悬停提示；静息隐藏，悬停或键盘聚焦到这条记录时出现（设计稿 Generation）。
  // 顺序：再次生成 · 编辑 · 下载 · 收进资产库 · 用作提示词 ｜ 删除（危险动作放最后）。
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/task:opacity-100 group-focus-within/task:opacity-100">
      <UiIconButton
        onClick={() => void onRegenerate()}
        title={t('ui:workspace.actions.regenerate')}
      >
        <RefreshCw className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton
        onClick={onReedit}
        title={t('ui:workspace.actions.reedit')}
      >
        <SquarePen className="h-4 w-4" />
      </UiIconButton>
      {task.result?.filePath && (
        <UiIconButton
          onClick={() => void onDownloadAll()}
          title={t('common:actions.download')}
        >
          <DownloadIcon className="h-4 w-4" />
        </UiIconButton>
      )}
      {task.result?.filePath && (
        <UiIconButton
          onClick={() => void onCollectAll()}
          disabled={collecting}
          on={allResultsCollected}
          title={t('ui:assetLibrary.collect')}
        >
          {allResultsCollected
            ? <FolderCheck className="h-4 w-4" />
            : <FolderPlus className="h-4 w-4" />}
        </UiIconButton>
      )}
      <UiIconButton
        onClick={onUsePrompt}
        title={t('ui:workspace.actions.usePrompt')}
      >
        <UsePromptIcon className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton tone="danger"
        onClick={() => void onDelete()}
        title={t('common:delete')}
      >
        <Trash2 className="h-4 w-4" />
      </UiIconButton>
    </div>
  )
}
