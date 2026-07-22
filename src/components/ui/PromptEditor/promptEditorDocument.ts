import type { JSONContent } from '@tiptap/core'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
  PromptMediaType,
  PromptParagraphV1,
} from '@/core/inputs/promptDocument'
import { normalizePromptDocument } from '@/core/inputs/promptDocument/normalize'

export { normalizePromptDocument }

export function promptDocumentsEqual(
  left: PromptDocumentV1,
  right: PromptDocumentV1,
): boolean {
  return JSON.stringify(normalizePromptDocument(left))
    === JSON.stringify(normalizePromptDocument(right))
}

export function toTiptapContent(document: PromptDocumentV1): JSONContent {
  const normalized = normalizePromptDocument(document)
  return {
    type: normalized.type,
    content: normalized.content as JSONContent[],
  }
}

export function fromTiptapContent(content: JSONContent): PromptDocumentV1 {
  const readString = (value: unknown): string => typeof value === 'string' ? value : ''
  const readMediaType = (value: unknown): PromptMediaType => (
    value === 'video' || value === 'audio' ? value : 'image'
  )
  const readInlineNode = (node: JSONContent): PromptInlineNodeV1 | null => {
    if (node.type === 'text') return { type: 'text', text: node.text ?? '' }
    if (node.type === 'hardBreak') return { type: 'hardBreak' }
    if (node.type === 'mediaReference') {
      const sourceNodeId = readString(node.attrs?.sourceNodeId)
      return {
        type: 'mediaReference',
        attrs: {
          resourceId: readString(node.attrs?.resourceId),
          mediaType: readMediaType(node.attrs?.mediaType),
          fallbackLabel: readString(node.attrs?.fallbackLabel) || '失效引用',
          ...(sourceNodeId ? { sourceNodeId } : {}),
        },
      }
    }
    if (node.type === 'templateVariable') {
      return {
        type: 'templateVariable',
        attrs: {
          key: readString(node.attrs?.key),
          fallbackLabel: readString(node.attrs?.fallbackLabel) || '失效变量',
        },
      }
    }
    return null
  }

  const paragraphs: PromptParagraphV1[] = (content.content ?? []).map((node) => ({
    type: 'paragraph',
    content: node.content
      ?.map(readInlineNode)
      .filter((item): item is PromptInlineNodeV1 => item !== null),
  }))

  return normalizePromptDocument({
    version: 1,
    type: 'doc',
    content: paragraphs,
  })
}

export function countPromptDocumentCharacters(document: PromptDocumentV1): number {
  let count = 0
  for (const paragraph of normalizePromptDocument(document).content) {
    for (const node of paragraph.content ?? []) {
      if (node.type === 'text') count += node.text.length
      else if (node.type === 'hardBreak') count += 1
      else count += node.attrs.fallbackLabel.length
    }
  }
  return count
}
