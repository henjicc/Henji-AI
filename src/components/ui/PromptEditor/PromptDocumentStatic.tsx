import { Fragment, memo, type KeyboardEvent, type ReactNode } from 'react'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
} from '@/core/inputs/promptDocument'
import type {
  PromptReferenceItem,
  PromptReferenceResolver,
  PromptVariableItem,
  PromptVariableResolver,
} from './types'

interface PromptDocumentStaticProps {
  document: PromptDocumentV1
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  onActivate?: () => void
  references?: readonly PromptReferenceItem[]
  variables?: readonly PromptVariableItem[]
  resolveReference?: PromptReferenceResolver
  resolveVariable?: PromptVariableResolver
}

interface StaticResolvers {
  resolveReference: PromptReferenceResolver
  resolveVariable: PromptVariableResolver
}

function renderInlineNode(
  node: PromptInlineNodeV1,
  key: string,
  resolvers: StaticResolvers,
): ReactNode {
  if (node.type === 'text') return node.text
  if (node.type === 'hardBreak') return <br key={key} />
  if (node.type === 'mediaReference') {
    const reference = resolvers.resolveReference(node.attrs.resourceId)
    const label = reference?.label ?? node.attrs.fallbackLabel
    return (
      <span
        key={key}
        className={`mx-0.5 inline-flex max-w-[180px] items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-xs ${reference ? 'border-border-dark bg-layer text-text-dark' : 'border-red-500/50 text-red-300'}`}
        data-prompt-media-reference=""
        data-reference-id={node.attrs.resourceId}
        data-reference-state={reference ? 'resolved' : 'missing'}
      >
        {reference?.thumbnailSrc ? (
          <img src={reference.thumbnailSrc} alt="" className="h-5 w-5 rounded object-cover" />
        ) : null}
        <span className="truncate">@{label}</span>
      </span>
    )
  }

  const variable = resolvers.resolveVariable(node.attrs.key)
  const label = variable?.label ?? node.attrs.fallbackLabel
  return (
    <span
      key={key}
      className={`mx-0.5 inline-flex max-w-[180px] whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-xs ${variable ? 'border-border-dark bg-layer text-text-dark' : 'border-red-500/50 text-red-300'}`}
      data-prompt-template-variable=""
      data-variable-key={node.attrs.key}
      data-variable-state={variable ? 'resolved' : 'missing'}
    >
      <span className="truncate">{'{{'}{label}{'}}'}</span>
    </span>
  )
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
  references = [],
  variables = [],
  resolveReference,
  resolveVariable,
}: PromptDocumentStaticProps): JSX.Element {
  const canActivate = Boolean(onActivate) && !disabled
  const resolvers: StaticResolvers = {
    resolveReference: resolveReference
      ?? ((resourceId) => references.find((item) => item.resourceId === resourceId)),
    resolveVariable: resolveVariable
      ?? ((key) => variables.find((item) => item.key === key)),
  }
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
              {renderInlineNode(node, `node-${paragraphIndex}-${nodeIndex}`, resolvers)}
            </Fragment>
          ))}
        </div>
      )) : (
        <span className="text-text-muted">{placeholder}</span>
      )}
    </div>
  )
})
