import { describe, expect, it } from 'vitest'
import {
  createEmptyPromptDocument,
  createPlainTextPromptDocument,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

import {
  countPromptDocumentCharacters,
  fromTiptapContent,
  normalizePromptDocument,
  promptDocumentsEqual,
  toTiptapContent,
} from './promptEditorDocument'

describe('promptEditorDocument', () => {
  it('为 Tiptap 剥离版本字段并可恢复受控文档', () => {
    const document = createPlainTextPromptDocument('第一行\n第二行')
    const content = toTiptapContent(document)

    expect(content).not.toHaveProperty('version')
    expect(promptDocumentsEqual(fromTiptapContent(content), document)).toBe(true)
  })

  it('将空 doc 规范为一个空段落，避免受控回写振荡', () => {
    const empty: PromptDocumentV1 = { version: 1, type: 'doc', content: [] }

    expect(normalizePromptDocument(empty)).toEqual(createEmptyPromptDocument())
  })

  it('字符统计包含换行与原子节点的降级标签', () => {
    const document: PromptDocumentV1 = {
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '主体' },
          { type: 'hardBreak' },
          {
            type: 'mediaReference',
            attrs: {
              resourceId: 'asset:a',
              mediaType: 'image',
              fallbackLabel: '图1',
            },
          },
          {
            type: 'templateVariable',
            attrs: { key: 'style', fallbackLabel: '风格' },
          },
        ],
      }],
    }

    expect(countPromptDocumentCharacters(document)).toBe(7)
  })
})
