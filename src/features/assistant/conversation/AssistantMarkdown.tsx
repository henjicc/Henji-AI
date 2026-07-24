import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AssistantMarkdownProps {
  children: string
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="ui-scrollbar my-2 max-w-full overflow-x-auto" data-assistant-markdown-table>
      <table>{children}</table>
    </div>
  ),
}

function AssistantMarkdownView({ children }: AssistantMarkdownProps): JSX.Element {
  return (
    <div className={[
      'min-w-0 break-words text-sm leading-6 text-text-dark',
      '[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline',
      '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border-dark [&_blockquote]:pl-3 [&_blockquote]:text-text-muted',
      '[&_code]:break-words [&_code]:rounded [&_code]:bg-layer [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]',
      '[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold',
      '[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold',
      '[&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:font-medium',
      '[&_hr]:my-3 [&_hr]:border-border-dark',
      '[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      '[&_p]:my-1.5 [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-layer [&_pre]:p-2',
      '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
      '[&_table]:w-full [&_table]:min-w-[360px] [&_table]:border-collapse [&_table]:text-xs',
      '[&_td]:border [&_td]:border-border-dark [&_td]:p-1.5 [&_th]:border [&_th]:border-border-dark [&_th]:bg-layer [&_th]:p-1.5 [&_th]:text-left',
    ].join(' ')}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export const AssistantMarkdown = memo(AssistantMarkdownView)
