import { Fragment, useMemo, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ImageOff } from 'lucide-react'

import type { PrototypeReference } from './prototypeTypes'

interface PromptDocumentStaticProps {
  document: JSONContent
  references: readonly PrototypeReference[]
  className?: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function renderContent(
  node: JSONContent,
  references: ReadonlyMap<string, PrototypeReference>,
  key: string,
): ReactNode {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return <br key={key} />
  if (node.type === 'mediaReference') {
    const id = readString(node.attrs?.id)
    const label = readString(node.attrs?.label) || '失效引用'
    const reference = references.get(id)
    return (
      <span
        key={key}
        className={`mx-0.5 inline-flex max-w-[180px] items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs ${
          reference
            ? 'border-border-dark bg-layer text-text-dark'
            : 'border-red-500/50 bg-surface-dark text-red-300'
        }`}
      >
        {reference?.thumbnailSrc ? (
          <img src={reference.thumbnailSrc} alt="" className="h-5 w-5 rounded object-cover" />
        ) : (
          <ImageOff className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">@{label}</span>
      </span>
    )
  }

  const children = node.content?.map((child, index) => (
    <Fragment key={`${key}-${index}`}>
      {renderContent(child, references, `${key}-${index}`)}
    </Fragment>
  ))
  if (node.type === 'paragraph') return <p key={key} className="min-h-[1.5em]">{children}</p>
  return children ?? null
}

export function PromptDocumentStatic({
  document,
  references,
  className = '',
}: PromptDocumentStaticProps): JSX.Element {
  const referenceMap = useMemo(
    () => new Map(references.map((reference) => [reference.id, reference])),
    [references],
  )

  return (
    <div className={`whitespace-pre-wrap break-words text-sm leading-6 text-text-dark ${className}`}>
      {renderContent(document, referenceMap, 'root')}
    </div>
  )
}
