import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import {
  compactPromptMediaReferenceSpacing,
  parseLegacyPromptString,
  type PromptDocumentV1,
  type PromptInlineNodeV1,
} from '@/core/inputs/promptDocument'
import type { PromptEditorResourceRegistry } from './resourceRegistry'

function containsMediaReference(document: PromptDocumentV1): boolean {
  return document.content.some((paragraph) => (
    paragraph.content?.some((node) => node.type === 'mediaReference') ?? false
  ))
}

function toInlineNodes(document: PromptDocumentV1): PromptInlineNodeV1[] {
  return document.content.flatMap((paragraph, index) => [
    ...(index > 0 ? [{ type: 'hardBreak' as const }] : []),
    ...(paragraph.content ?? []),
  ])
}

export function pastePromptMediaReferences(
  view: EditorView,
  event: ClipboardEvent,
  registry: PromptEditorResourceRegistry,
): boolean {
  const clipboard = event.clipboardData
  if (!clipboard) return false
  if (clipboard.getData('text/html').includes('data-prompt-media-reference')) return false

  const text = clipboard.getData('text/plain')
  if (!text) return false
  const references = registry.getReferences()
  if (references.length === 0) return false

  const document = compactPromptMediaReferenceSpacing(parseLegacyPromptString(text, {
    references: references.map((reference) => ({
      resourceId: reference.resourceId,
      mediaType: reference.mediaType,
      label: reference.label,
      legacyLabels: reference.legacyLabels,
      sourceNodeId: reference.sourceNodeId,
    })),
  }))
  if (!containsMediaReference(document)) return false

  const nodes = toInlineNodes(document).map((node) => view.state.schema.nodeFromJSON(node))
  event.preventDefault()
  view.dispatch(
    view.state.tr
      .replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
      .scrollIntoView(),
  )
  return true
}
