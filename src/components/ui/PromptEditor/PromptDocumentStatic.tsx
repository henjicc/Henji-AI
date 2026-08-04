import {
  Fragment,
  forwardRef,
  memo,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from 'react'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
} from '@/core/inputs/promptDocument'
import type {
  PromptReferenceItem,
  PromptReferenceResolver,
  PromptEditorActivation,
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
  onActivate?: (activation?: PromptEditorActivation) => void
  references?: readonly PromptReferenceItem[]
  variables?: readonly PromptVariableItem[]
  resolveReference?: PromptReferenceResolver
  resolveVariable?: PromptVariableResolver
}

interface StaticResolvers {
  resolveReference: PromptReferenceResolver
  resolveVariable: PromptVariableResolver
}

interface DomCaretPoint {
  node: Node
  offset: number
}

type CaretLookupDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => {
    offsetNode: Node
    offset: number
  } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

const SELECTION_EDGE_INSET_PX = 1

function clampPointToElement(
  element: HTMLElement,
  point: { clientX: number; clientY: number },
): { clientX: number; clientY: number } {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return point
  return {
    clientX: Math.min(
      Math.max(point.clientX, rect.left + SELECTION_EDGE_INSET_PX),
      rect.right - SELECTION_EDGE_INSET_PX,
    ),
    clientY: Math.min(
      Math.max(point.clientY, rect.top + SELECTION_EDGE_INSET_PX),
      rect.bottom - SELECTION_EDGE_INSET_PX,
    ),
  }
}

function resolveCaretPoint(
  element: HTMLElement,
  point: { clientX: number; clientY: number },
): DomCaretPoint | null {
  const ownerDocument = element.ownerDocument as CaretLookupDocument
  const caretPosition = ownerDocument.caretPositionFromPoint?.(point.clientX, point.clientY)
  if (caretPosition && element.contains(caretPosition.offsetNode)) {
    return { node: caretPosition.offsetNode, offset: caretPosition.offset }
  }

  const caretRange = ownerDocument.caretRangeFromPoint?.(point.clientX, point.clientY)
  if (caretRange && element.contains(caretRange.startContainer)) {
    return { node: caretRange.startContainer, offset: caretRange.startOffset }
  }
  return null
}

function constrainLiveSelection(
  element: HTMLElement,
  anchor: DomCaretPoint,
  headPoint: { clientX: number; clientY: number },
): boolean {
  const head = resolveCaretPoint(element, headPoint)
  const selection = element.ownerDocument.defaultView?.getSelection()
  if (!head || !selection?.setBaseAndExtent) return false
  const alreadyConstrained = selection.anchorNode === anchor.node
    && selection.anchorOffset === anchor.offset
    && selection.focusNode === head.node
    && selection.focusOffset === head.offset
  if (!alreadyConstrained) {
    selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset)
  }
  return true
}

interface UserSelectSnapshot {
  element: HTMLElement
  userSelect: string
  userSelectPriority: string
  webkitUserSelect: string
  webkitUserSelectPriority: string
}

function suppressOtherCanvasTextSelections(origin: HTMLElement): () => void {
  const selectionRoot = origin.closest('.react-flow') ?? origin.ownerDocument.body
  const snapshots: UserSelectSnapshot[] = Array.from(
    selectionRoot.querySelectorAll<HTMLElement>('[role="textbox"]'),
  ).filter((element) => element !== origin && !origin.contains(element)).map((element) => ({
    element,
    userSelect: element.style.getPropertyValue('user-select'),
    userSelectPriority: element.style.getPropertyPriority('user-select'),
    webkitUserSelect: element.style.getPropertyValue('-webkit-user-select'),
    webkitUserSelectPriority: element.style.getPropertyPriority('-webkit-user-select'),
  }))

  snapshots.forEach(({ element }) => {
    element.style.setProperty('user-select', 'none', 'important')
    element.style.setProperty('-webkit-user-select', 'none', 'important')
  })

  return () => snapshots.forEach((snapshot) => {
    const { element } = snapshot
    if (snapshot.userSelect) {
      element.style.setProperty(
        'user-select',
        snapshot.userSelect,
        snapshot.userSelectPriority,
      )
    } else {
      element.style.removeProperty('user-select')
    }
    if (snapshot.webkitUserSelect) {
      element.style.setProperty(
        '-webkit-user-select',
        snapshot.webkitUserSelect,
        snapshot.webkitUserSelectPriority,
      )
    } else {
      element.style.removeProperty('-webkit-user-select')
    }
  })
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
        className={`${PROMPT_MEDIA_ATOM_CLASS} ${reference ? 'border-transparent bg-veil-faint text-text-soft' : 'border-red-500/50 text-red-300'}`}
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
      className={`${PROMPT_ATOM_CLASS} ${variable ? 'border-transparent bg-veil-faint text-text-soft' : 'border-red-500/50 text-red-300'}`}
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
    const removeDragListenersRef = useRef<(() => void) | null>(null)
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
    const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
      if (!canActivate || event.button !== 0) return
      removeDragListenersRef.current?.()
      const contentElement = event.currentTarget
      const ownerWindow = contentElement.ownerDocument.defaultView
      if (!ownerWindow) return
      const anchor = { clientX: event.clientX, clientY: event.clientY }
      const anchorCaret = resolveCaretPoint(contentElement, anchor)
      let latestHead = anchor
      const restoreOtherTextSelections = suppressOtherCanvasTextSelections(contentElement)
      const handleWindowMouseMove = (mouseMoveEvent: globalThis.MouseEvent): void => {
        if (!anchorCaret || (mouseMoveEvent.buttons & 1) === 0) return
        latestHead = clampPointToElement(contentElement, {
          clientX: mouseMoveEvent.clientX,
          clientY: mouseMoveEvent.clientY,
        })
        if (constrainLiveSelection(contentElement, anchorCaret, latestHead)) {
          mouseMoveEvent.preventDefault()
        }
      }
      const handleSelectionChange = (): void => {
        if (anchorCaret) {
          constrainLiveSelection(contentElement, anchorCaret, latestHead)
        }
      }
      const handleWindowMouseUp = (mouseUpEvent: globalThis.MouseEvent): void => {
        removeDragListenersRef.current?.()
        removeDragListenersRef.current = null
        if (mouseUpEvent.button !== 0) return
        const head = clampPointToElement(contentElement, {
          clientX: mouseUpEvent.clientX,
          clientY: mouseUpEvent.clientY,
        })
        const isDragSelection = Math.abs(head.clientX - anchor.clientX) > 2
          || Math.abs(head.clientY - anchor.clientY) > 2
        onActivate?.(isDragSelection ? { anchor, head } : head)
      }
      ownerWindow.addEventListener('mousemove', handleWindowMouseMove)
      ownerWindow.addEventListener('mouseup', handleWindowMouseUp)
      contentElement.ownerDocument.addEventListener('selectionchange', handleSelectionChange)
      removeDragListenersRef.current = () => {
        ownerWindow.removeEventListener('mousemove', handleWindowMouseMove)
        ownerWindow.removeEventListener('mouseup', handleWindowMouseUp)
        contentElement.ownerDocument.removeEventListener('selectionchange', handleSelectionChange)
        restoreOtherTextSelections()
      }
    }

    useEffect(() => () => removeDragListenersRef.current?.(), [])

    return (
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-readonly="true"
        aria-disabled={disabled}
        tabIndex={canActivate ? 0 : -1}
        className={`${PROMPT_EDITOR_CONTENT_CLASS} ${canActivate ? 'cursor-text select-text' : ''} ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
        onMouseDown={canActivate ? handleMouseDown : undefined}
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
