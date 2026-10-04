export interface TaskPromptProps {
  prompt: string
}

/** 记录的提示词：正文 14 / 22，单行省略，全文放悬停提示（设计稿 Generation）。 */
export function TaskPrompt({ prompt }: TaskPromptProps): JSX.Element {
  return (
    <p className="m-0 truncate text-14 leading-5.5 text-text1" title={prompt}>
      {prompt}
    </p>
  )
}
