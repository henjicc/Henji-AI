import { describe, expect, it } from 'vitest'

import { toModelPromptText } from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
  remapRemovedPromptImages,
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

  it('keeps the identity of an image replaced in place, new images get a new identity', () => {
    const createId = createIdFactory()
    const initial = reconcileMediaGeneratorPromptImages([], ['same', 'same'], createId)
    const replaced = reconcileMediaGeneratorPromptImages(initial, ['same', 'new'], createId)
    expect(replaced).toEqual([
      { resourceId: 'resource-1', url: 'same' },
      { resourceId: 'resource-2', url: 'new' },
    ])

    const appended = reconcileMediaGeneratorPromptImages(initial, ['same', 'same', 'other'], createId)
    expect(appended.map((image) => image.resourceId)).toEqual(['resource-1', 'resource-2', 'resource-3'])
    const shifted = reconcileMediaGeneratorPromptImages(replaced, ['new', 'other'], createId)
    expect(shifted.map((image) => image.resourceId)).toEqual(['resource-2', 'resource-4'])

    // 同一文件导入过两次，替换第一张：新图沿用第一张的身份，第二张不动
    const firstReplaced = reconcileMediaGeneratorPromptImages(initial, ['fresh', 'same'], createId)
    expect(firstReplaced.map((image) => image.resourceId)).toEqual(['resource-1', 'resource-2'])
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
  it('删掉的参考图，引用改指同一位置的新图；同一文件的另一张还在就指向它；同一位置没有图时不改', () => {
    const createId = createIdFactory()
    const [a, b, c] = reconcileMediaGeneratorPromptImages([], ['a', 'b', 'c'], createId)
    expect(remapRemovedPromptImages([a, b, c], [b, c])).toEqual(new Map([[a.resourceId, b.resourceId]]))
    expect(remapRemovedPromptImages([a, b, c], [a, b]).size).toBe(0)
    expect(remapRemovedPromptImages([a, b, c], [c, b, a]).size).toBe(0)

    const [first, second] = reconcileMediaGeneratorPromptImages([], ['same', 'same'], createId)
    const afterDelete = reconcileMediaGeneratorPromptImages([first, second], ['same'], createId)
    expect(remapRemovedPromptImages([first, second], afterDelete)).toEqual(new Map([[second.resourceId, first.resourceId]]))
  })
})
