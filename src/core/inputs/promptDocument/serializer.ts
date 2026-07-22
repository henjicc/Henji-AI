import type { PromptDocumentV1, PromptInlineNodeV1 } from './types'
import type { PromptDocumentSerializationContext } from './serializationTypes'

type SerializationFormat = 'legacy' | 'model' | 'markdown'

function resolveReferenceLabel(
  resourceId: string,
  fallbackLabel: string,
  context: PromptDocumentSerializationContext,
): string {
  return context.resolveReferenceLabel?.(resourceId)
    ?? context.references?.find((reference) => reference.resourceId === resourceId)?.label
    ?? fallbackLabel
}

function escapeMarkdownLabel(label: string): string {
  return label
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function serializeInlineNode(
  node: PromptInlineNodeV1,
  format: SerializationFormat,
  context: PromptDocumentSerializationContext,
): string {
  if (node.type === 'text') return node.text
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'templateVariable') return `{{${node.attrs.key}}}`

  const label = resolveReferenceLabel(
    node.attrs.resourceId,
    node.attrs.fallbackLabel,
    context,
  )
  if (format === 'model') return label
  if (format === 'markdown') {
    return `@[${escapeMarkdownLabel(label)}](henji-media:${encodeURIComponent(node.attrs.resourceId)})`
  }
  return `@${label}`
}

function serializeDocument(
  document: PromptDocumentV1,
  format: SerializationFormat,
  context: PromptDocumentSerializationContext,
): string {
  return document.content.map((paragraph) => (
    (paragraph.content ?? [])
      .map((node) => serializeInlineNode(node, format, context))
      .join('')
  )).join('\n')
}

export function toLegacyPromptString(
  document: PromptDocumentV1,
  context: PromptDocumentSerializationContext = {},
): string {
  return serializeDocument(document, 'legacy', context)
}

export function toModelPromptText(
  document: PromptDocumentV1,
  context: PromptDocumentSerializationContext = {},
): string {
  return serializeDocument(document, 'model', context)
}

export function toMarkdown(
  document: PromptDocumentV1,
  context: PromptDocumentSerializationContext = {},
): string {
  return serializeDocument(document, 'markdown', context)
}

export function toPromptPlainText(
  document: PromptDocumentV1,
  context: PromptDocumentSerializationContext = {},
): string {
  return toLegacyPromptString(document, context)
}
