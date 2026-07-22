import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
  PromptParagraphV1,
} from './types'

function normalizeInlineNode(node: PromptInlineNodeV1): PromptInlineNodeV1 {
  if (node.type !== 'mediaReference') return node

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

export function compactPromptMediaReferenceSpacing(
  document: PromptDocumentV1,
): PromptDocumentV1 {
  return {
    ...document,
    content: document.content.map((paragraph) => {
      const nodes = paragraph.content ?? []
      const content: PromptInlineNodeV1[] = []
      nodes.forEach((node, index) => {
        if (node.type !== 'text') {
          content.push(node)
          return
        }
        const previousIsReference = nodes[index - 1]?.type === 'mediaReference'
        const nextIsReference = nodes[index + 1]?.type === 'mediaReference'
        let text = node.text
        if (previousIsReference) text = text.replace(/^[ \t]+/, '')
        if (nextIsReference) text = text.replace(/[ \t]+$/, '')
        if (text) content.push({ ...node, text })
      })
      return content.length ? { ...paragraph, content } : { type: 'paragraph' as const }
    }),
  }
}
