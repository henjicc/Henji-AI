import { Fragment, memo, type KeyboardEvent, type ReactNode } from 'react'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
} from '@/core/inputs/promptDocument'

interface PromptDocumentStaticProps {
  document: PromptDocumentV1
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  onActivate?: () => void
}

function renderInlineNode(node: PromptInlineNodeV1, key: string): ReactNode {
  if (node.type === 'text') return node.text
  if (node.type === 'hardBreak') return <br key={key} />
  if (node.type === 'mediaReference') return `@${node.attrs.fallbackLabel}`
  return `{{${node.attrs.key}}}`
}

function hasVisibleContent(document: PromptDocumentV1): boolean {
  return document.content.some((paragraph) => (paragraph.content?.length ?? 0) > 0)
}

export const PromptDocumentStatic = memo(function PromptDocumentStatic({
  document,
  ariaLabel,
  placeholder = '',
  disabled = false,
  className = '',
  onActivate,
}: PromptDocumentStaticProps): JSX.Element {
  const canActivate = Boolean(onActivate) && !disabled
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!canActivate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onActivate?.()
  }

  return (
    <div
      role="textbox"
      aria-label={ariaLabel}
      aria-readonly="true"
      aria-disabled={disabled}
      tabIndex={canActivate ? 0 : -1}
      className={`min-h-[92px] whitespace-pre-wrap break-words rounded-lg border border-border-dark bg-surface-dark px-3 py-2.5 text-sm leading-6 text-text-dark ${canActivate ? 'cursor-text' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      onClick={canActivate ? onActivate : undefined}
      onKeyDown={handleKeyDown}
    >
      {hasVisibleContent(document) ? document.content.map((paragraph, paragraphIndex) => (
        <div key={`paragraph-${paragraphIndex}`} className="min-h-[1.5em]">
          {paragraph.content?.map((node, nodeIndex) => (
            <Fragment key={`node-${paragraphIndex}-${nodeIndex}`}>
              {renderInlineNode(node, `node-${paragraphIndex}-${nodeIndex}`)}
            </Fragment>
          ))}
        </div>
      )) : (
        <span className="text-text-muted">{placeholder}</span>
      )}
    </div>
  )
})
