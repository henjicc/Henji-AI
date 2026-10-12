import { UI_TEXT_PANEL_TITLE_CLASS } from '@/components/ui'

export interface TaskPromptProps {
  prompt: string
}

/** 记录标题最多两行，全文保留在悬停提示中。 */
export function TaskPrompt({ prompt }: TaskPromptProps): JSX.Element {
  return (
    <p className={`m-0 min-w-0 flex-1 line-clamp-2 break-words ${UI_TEXT_PANEL_TITLE_CLASS}`} title={prompt}>
      {prompt}
    </p>
  )
}
