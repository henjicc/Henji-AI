import { FolderCheck, FolderPlus, Trash2 } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import { ICON_DOWNLOAD, ICON_REEDIT, ICON_REGENERATE, ICON_USE_PROMPT } from '@/core/theme/icons'
import type { AvailableGenerationContinuation } from '@/core/services/generationContinuations'
import { useI18n } from '@/hooks/useI18n'
import type { GenerationTask } from '../types'

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
  /** 这次结果能做的续接（草稿转正片、续写、做成视频） */
  continuations: AvailableGenerationContinuation[]
  onContinue: (continuationId: string) => void
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
  continuations,
  onContinue,
}: TaskCardToolbarProps): JSX.Element {
  const { t } = useI18n()

  // 记录工具条：图标化、名称进悬停提示；静息隐藏，悬停或键盘聚焦到这条记录时出现（设计稿 Generation）。
  // 顺序：续接 · 再次生成 · 编辑 · 下载 · 收进资产库 · 用作提示词 ｜ 删除（危险动作放最后）。
  // 续接是这个结果特有的下一步，图标说不清，用文字。
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/task:opacity-100 group-focus-within/task:opacity-100 [@media(hover:none)]:opacity-100">
      {continuations.map(continuation => (
        <UiButton key={continuation.id} size="sm"
          onClick={() => onContinue(continuation.id)}
          tooltip={t(`ui:workspace.continuation.tooltip.${continuation.id}`)}
          data-generation-continuation={continuation.id}
        >
          {t(`ui:workspace.continuation.action.${continuation.id}`)}
        </UiButton>
      ))}
      <UiIconButton tone="rest"
        onClick={() => void onRegenerate()}
        tooltip={t('ui:workspace.actions.regenerate')}
      >
        <ICON_REGENERATE />
      </UiIconButton>
      <UiIconButton tone="rest"
        onClick={onReedit}
        tooltip={t('ui:workspace.actions.reedit')}
      >
        <ICON_REEDIT />
      </UiIconButton>
      {task.result && task.result.filePaths.length > 0 && (
        <UiIconButton tone="rest"
          onClick={() => void onDownloadAll()}
          tooltip={t('common:actions.download')}
        >
          <ICON_DOWNLOAD />
        </UiIconButton>
      )}
      {task.result && task.result.filePaths.length > 0 && (
        <UiIconButton tone="rest"
          onClick={() => void onCollectAll()}
          disabled={collecting}
          on={allResultsCollected}
          tooltip={t('ui:assetLibrary.collect')}
        >
          {allResultsCollected
            ? <FolderCheck  />
            : <FolderPlus  />}
        </UiIconButton>
      )}
      <UiIconButton tone="rest"
        onClick={onUsePrompt}
        tooltip={t('ui:workspace.actions.usePrompt')}
      >
        <ICON_USE_PROMPT />
      </UiIconButton>
      <UiIconButton tone="restDanger"
        onClick={() => void onDelete()}
        tooltip={t('common:delete')}
      >
        <Trash2  />
      </UiIconButton>
    </div>
  )
}
