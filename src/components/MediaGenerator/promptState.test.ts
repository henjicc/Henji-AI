import { describe, expect, it } from 'vitest'

import { toModelPromptText } from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
  resolveMediaGeneratorPromptCarrier,
} from './promptState'

function createIdFactory(): () => string {
  let nextId = 0
  return () => `resource-${nextId += 1}`
}

describe('MediaGenerator prompt state', () => {
  it('preserves resource identity while image labels follow reordering', () => {
    const createId = createIdFactory()
    const initial = reconcileMediaGeneratorPromptImages([], ['a', 'b'], createId)
    const parsed = resolveMediaGeneratorPromptCarrier({
      legacyText: '@图1 跟随 @图2',
      bindings: initial.map((image) => ({
        resourceId: image.resourceId,
        mediaType: 'image',
        dataUrl: image.url,
      })),
    }, createId)
    const reordered = reconcileMediaGeneratorPromptImages(initial, ['b', 'a'], createId)
    const references = createMediaGeneratorPromptReferences(reordered)

    expect(reordered.map((image) => image.resourceId)).toEqual(['resource-2', 'resource-1'])
    expect(toModelPromptText(parsed.document, { references })).toBe('图片2 跟随 图片1')
  })

  it('creates a new identity for replacement while retaining duplicate occurrences', () => {
    const createId = createIdFactory()
    const initial = reconcileMediaGeneratorPromptImages([], ['same', 'same'], createId)
    const replaced = reconcileMediaGeneratorPromptImages(initial, ['same', 'new'], createId)

    expect(replaced).toEqual([
      { resourceId: 'resource-1', url: 'same' },
      { resourceId: 'resource-3', url: 'new' },
    ])
  })

  it('prefers a valid structured preset and restores its persisted bindings', () => {
    const resolved = resolveMediaGeneratorPromptCarrier({
      document: {
        version: 1,
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'mediaReference',
            attrs: { resourceId: 'saved-id', mediaType: 'image', fallbackLabel: '图1' },
          }],
        }],
      },
      legacyText: '@图1',
      bindings: [{ resourceId: 'saved-id', mediaType: 'image', dataUrl: 'saved-data' }],
    })

    expect(resolved.images).toEqual([{ resourceId: 'saved-id', url: 'saved-data' }])
    expect(resolved.document.content[0].content?.[0]).toMatchObject({
      type: 'mediaReference',
      attrs: { resourceId: 'saved-id' },
    })
  })

  it('ignores damaged persisted bindings and preserves legacy text', () => {
    const resolved = resolveMediaGeneratorPromptCarrier({
      document: { version: 99 },
      legacyText: '保留损坏预设正文',
      bindings: [null, { resourceId: 1, mediaType: 'image', dataUrl: false }],
      legacyImages: ['fallback-image', null],
    }, createIdFactory())

    expect(resolved.images).toEqual([{ resourceId: 'resource-1', url: 'fallback-image' }])
    expect(resolved.document.content[0].content).toEqual([
      { type: 'text', text: '保留损坏预设正文' },
    ])
  })

  it('载入旧字符串时移除引用边界空格，模型输出再恢复单个空格', () => {
    const resolved = resolveMediaGeneratorPromptCarrier({
      legacyText: '参考 @图1 然后修改',
      legacyImages: ['image-a'],
    }, createIdFactory())
    const references = createMediaGeneratorPromptReferences(resolved.images)

    expect(resolved.document.content[0].content).toEqual([
      { type: 'text', text: '参考' },
      {
        type: 'mediaReference',
        attrs: {
          resourceId: 'resource-1',
          mediaType: 'image',
          fallbackLabel: '图片1',
        },
      },
      { type: 'text', text: '然后修改' },
    ])
    expect(toModelPromptText(resolved.document, { references }))
      .toBe('参考 图片1 然后修改')
  })
})
