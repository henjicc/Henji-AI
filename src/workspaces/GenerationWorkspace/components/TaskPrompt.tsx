import { UI_TEXT_PANEL_TITLE_CLASS } from '@/components/ui'

export interface TaskPromptProps {
  prompt: string
}

/** 记录标题单行，与参考素材、信息排成一条；全文保留在悬停提示中。 */
export function TaskPrompt({ prompt }: TaskPromptProps): JSX.Element {
  return (
    <p className={`m-0 min-w-0 truncate leading-tight ${UI_TEXT_PANEL_TITLE_CLASS}`} title={prompt}>
      {prompt}
    </p>
  )
}
