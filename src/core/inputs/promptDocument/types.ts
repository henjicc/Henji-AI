export type PromptMediaType = 'image' | 'video' | 'audio'

export interface PromptMediaBinding {
  resourceId: string
  mediaType: PromptMediaType
  dataUrl?: string
  filePath?: string
}

export interface PromptTextV1 {
  type: 'text'
  text: string
}

export interface PromptHardBreakV1 {
  type: 'hardBreak'
}

export interface PromptMediaReferenceV1 {
  type: 'mediaReference'
  attrs: {
    resourceId: string
    mediaType: PromptMediaType
    fallbackLabel: string
    sourceNodeId?: string
  }
}

export interface PromptTemplateVariableV1 {
  type: 'templateVariable'
  attrs: {
    key: string
    fallbackLabel: string
  }
}

export type PromptInlineNodeV1 =
  | PromptTextV1
  | PromptHardBreakV1
  | PromptMediaReferenceV1
  | PromptTemplateVariableV1

export interface PromptParagraphV1 {
  type: 'paragraph'
  content?: PromptInlineNodeV1[]
}

export interface PromptDocumentV1 {
  version: 1
  type: 'doc'
  content: PromptParagraphV1[]
}

export function createEmptyPromptDocument(): PromptDocumentV1 {
  return {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}

export function createPlainTextPromptDocument(text: string): PromptDocumentV1 {
  const lines = text.split('\n')
  const content: PromptParagraphV1[] = []

  lines.forEach((line, index) => {
    const paragraph = content[content.length - 1]
    if (!paragraph || index === 0) {
      content.push({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : undefined,
      })
      return
    }

    const inlineContent = paragraph.content ?? []
    inlineContent.push({ type: 'hardBreak' })
    if (line) inlineContent.push({ type: 'text', text: line })
    paragraph.content = inlineContent
  })

  return { version: 1, type: 'doc', content }
}
