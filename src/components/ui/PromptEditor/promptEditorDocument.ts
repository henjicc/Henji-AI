import type { JSONContent } from '@tiptap/core'
import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
  PromptParagraphV1,
} from '@/core/inputs/promptDocument'

function normalizeInlineNode(node: PromptInlineNodeV1): PromptInlineNodeV1 {
  if (node.type === 'mediaReference') {
    const { sourceNodeId: _sourceNodeId, ...attrs } = node.attrs
    const sourceNodeId = node.attrs.sourceNodeId?.trim()
    return {
      ...node,
      attrs: {
        ...attrs,
        ...(sourceNodeId ? { sourceNodeId } : {}),
      },
    }
  }

  return node
}

function normalizeParagraph(paragraph: PromptParagraphV1): PromptParagraphV1 {
  const content = paragraph.content?.map(normalizeInlineNode)
  return content?.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export function normalizePromptDocument(document: PromptDocumentV1): PromptDocumentV1 {
  const content = document.content.map(normalizeParagraph)
  return {
    version: 1,
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  }
}

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
  const paragraphs: PromptParagraphV1[] = (content.content ?? []).map((node) => ({
    type: 'paragraph',
    content: node.content as PromptInlineNodeV1[] | undefined,
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
