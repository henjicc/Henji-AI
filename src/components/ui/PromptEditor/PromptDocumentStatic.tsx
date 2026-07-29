import {
  Fragment,
  forwardRef,
  memo,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
} from '@/core/inputs/promptDocument'
import type {
  PromptReferenceItem,
  PromptReferenceResolver,
  PromptEditorActivationPoint,
  PromptVariableItem,
  PromptVariableResolver,
} from './types'
import {
  PROMPT_ATOM_CLASS,
  PROMPT_EDITOR_CONTENT_CLASS,
  PROMPT_MEDIA_ATOM_CLASS,
} from './promptEditorStyles'

interface PromptDocumentStaticProps {
  document: PromptDocumentV1
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  onActivate?: (point?: PromptEditorActivationPoint) => void
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
        className={`${PROMPT_MEDIA_ATOM_CLASS} ${reference ? 'border-border-dark bg-layer text-text-dark' : 'border-red-500/50 text-red-300'}`}
        data-prompt-media-reference=""
        data-reference-id={node.attrs.resourceId}
        data-reference-state={reference ? 'resolved' : 'missing'}
      >
        {reference?.thumbnailSrc ? (
          <img src={reference.thumbnailSrc} alt="" className="h-[1.25em] w-[1.25em] rounded object-cover" />
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
      className={`${PROMPT_ATOM_CLASS} ${variable ? 'border-border-dark bg-layer text-text-dark' : 'border-red-500/50 text-red-300'}`}
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

const PromptDocumentStaticView = forwardRef<HTMLDivElement, PromptDocumentStaticProps>(
  function PromptDocumentStatic({
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
  }: PromptDocumentStaticProps, ref): JSX.Element {
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
    const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
      if (!canActivate) return
      onActivate?.({ clientX: event.clientX, clientY: event.clientY })
    }

    return (
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-readonly="true"
        aria-disabled={disabled}
        tabIndex={canActivate ? 0 : -1}
        className={`${PROMPT_EDITOR_CONTENT_CLASS} ${canActivate ? 'cursor-text' : ''} ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
        onClick={canActivate ? handleClick : undefined}
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
  },
)

PromptDocumentStaticView.displayName = 'PromptDocumentStaticView'

export const PromptDocumentStatic = memo(PromptDocumentStaticView)

PromptDocumentStatic.displayName = 'PromptDocumentStatic'
