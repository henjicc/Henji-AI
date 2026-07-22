import { describe, expect, it } from 'vitest'

import { toModelPromptText } from '@/core/inputs/promptDocument'
import {
  resolveStoryboardPromptDocument,
  resolveStoryboardPromptReferenceIndex,
} from './storyboardPromptDocument'

const references = [
  {
    resourceId: 'canvas-output:node-a:source:0',
    mediaType: 'image' as const,
    label: '图片1',
    legacyLabels: ['图1'],
  },
  {
    resourceId: 'canvas-output:node-b:source:0',
    mediaType: 'image' as const,
    label: '图片2',
    legacyLabels: ['图2'],
  },
]

describe('storyboardPromptDocument', () => {
  it('旧分镜文本升级为稳定媒体节点并同步兼容字符串', () => {
    const resolved = resolveStoryboardPromptDocument({
      legacyText: '参考@图1保持构图',
      carrierType: 'storyboard-gen-frame',
      carrierId: 'node:frame-1',
      references,
    })

    expect(JSON.stringify(resolved.document)).toContain('canvas-output:node-a:source:0')
    expect(resolved.legacyText).toBe('参考@图片1保持构图')
    expect(resolved.referenceIndex).toBe(0)
    expect(toModelPromptText(resolved.document, { references }))
      .toBe('参考 图片1 保持构图')
  })

  it('媒体重排只改变显示序号，不改变引用身份', () => {
    const initial = resolveStoryboardPromptDocument({
      legacyText: '@图片1作为主体',
      carrierType: 'storyboard-gen-frame',
      carrierId: 'node:frame-1',
      references,
    })
    const reorderedReferences = [references[1], references[0]].map((reference, index) => ({
      ...reference,
      label: `图片${index + 1}`,
      legacyLabels: [`图${index + 1}`],
    }))
    const reordered = resolveStoryboardPromptDocument({
      document: initial.document,
      legacyText: initial.legacyText,
      carrierType: 'storyboard-gen-frame',
      carrierId: 'node:frame-1',
      references: reorderedReferences,
    })

    expect(JSON.stringify(reordered.document)).toContain('canvas-output:node-a:source:0')
    expect(reordered.legacyText).toBe('@图片2作为主体')
    expect(resolveStoryboardPromptReferenceIndex(reordered.document, reorderedReferences)).toBe(1)
  })
})
