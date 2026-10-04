import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AssistantMarkdownProps {
  children: string
  compact?: boolean
  /** 正文用主要文字；思考过程这类从属内容用次要文字。 */
  tone?: 'primary' | 'secondary'
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="ui-scrollbar my-2 max-w-full overflow-x-auto" data-assistant-markdown-table>
      <table>{children}</table>
    </div>
  ),
}

/**
 * 助手回复的 Markdown 排版。层次只用登记的字号档与语义色：
 * 链接用强调文字色（accent 本身是填充色，不能当文字色）；代码块与行内代码下沉到窗口底（内层只比面板更暗）；
 * 表格只画行间分隔线，不画整格边框，窄侧栏里超宽时横向滚动。
 */
function AssistantMarkdownView({ children, compact = false, tone = 'primary' }: AssistantMarkdownProps): JSX.Element {
  return (
    <div className={[
      'min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] text-13 leading-6',
      tone === 'secondary' ? 'text-text2' : 'text-text1',
      '[&_a]:break-words [&_a]:text-accent-text [&_a]:underline-offset-2 hover:[&_a]:underline',
      '[&_strong]:font-semibold',
      '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-text2',
      '[&_code]:break-all [&_code]:rounded [&_code]:bg-window [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
      '[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold',
      '[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold',
      '[&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-13 [&_h3]:font-semibold',
      '[&_hr]:my-3 [&_hr]:border-line',
      compact
        ? '[&_li]:my-0 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5'
        : '[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      compact
        ? '[&_p]:my-0.5 [&_pre]:my-1'
        : '[&_p]:my-1.5 [&_pre]:my-2',
      '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-window [&_pre]:px-3 [&_pre]:py-2 [&_pre]:leading-5',
      '[&_pre_code]:break-normal [&_pre_code]:bg-transparent [&_pre_code]:p-0',
      '[&_table]:w-full [&_table]:min-w-80 [&_table]:border-collapse [&_table]:text-xs',
      '[&_tr]:border-b [&_tr]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
      '[&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-text2',
    ].join(' ')}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export const AssistantMarkdown = memo(AssistantMarkdownView)
