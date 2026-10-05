import { describe, expect, it } from 'vitest'

import { videoEditDocumentKind } from './videoEdit'

/*
 * 剪辑类型登记（3.1）：真实内容 schema、空内容判断与列表摘要。
 */

function content() {
  const created = videoEditDocumentKind.createEmptyContent()
  return videoEditDocumentKind.contentSchema.parse(created)
}

describe('剪辑类型登记', () => {
  it('新建的空内容是一条空序列，算空；只改序列规格或多一条空序列仍算空', () => {
    const empty = content()
    expect(empty.sequences).toHaveLength(1)
    expect(videoEditDocumentKind.isEmptyContent(empty)).toBe(true)
    const tweaked = { ...empty, sequences: [{ ...empty.sequences[0], width: 3840, height: 2160 }, { ...empty.sequences[0], id: 'second' }] }
    expect(videoEditDocumentKind.isEmptyContent(videoEditDocumentKind.contentSchema.parse(tweaked))).toBe(true)
  })

  it('引用了素材、有片段或字幕时不为空；摘要给出片段数与最长序列时长', () => {
    const empty = content()
    const withMedia = videoEditDocumentKind.contentSchema.parse({ ...empty, media: [{ id: 'm', path: '/媒体/a.mp4', name: 'a' }] })
    expect(videoEditDocumentKind.isEmptyContent(withMedia)).toBe(false)
    const sequence = { ...empty.sequences[0], clips: [{ id: 'c1', start: 0, duration: 90 }, { id: 'c2', start: 90, duration: 60 }] }
    const withClips = videoEditDocumentKind.contentSchema.parse({ ...empty, sequences: [sequence] })
    expect(videoEditDocumentKind.isEmptyContent(withClips)).toBe(false)
    expect(videoEditDocumentKind.summarize(withClips)).toEqual({ clips: 2, durationSeconds: 5 })
    const captioned = videoEditDocumentKind.contentSchema.parse({ ...empty, sequences: [{ ...empty.sequences[0], captions: [{ id: 'cap', start: 0, duration: 30, text: '字' }] }] })
    expect(videoEditDocumentKind.isEmptyContent(captioned)).toBe(false)
    expect(videoEditDocumentKind.summarize(captioned)).toEqual({ clips: 0, durationSeconds: 1 })
  })

  it('保留嵌套的未知字段（主进程保存的是解析结果）；没有序列的内容不合法', () => {
    const empty = content()
    const parsed = videoEditDocumentKind.contentSchema.parse({ ...empty, sequences: [{ ...empty.sequences[0], futureField: { keep: true }, clips: [{ id: 'c', start: 0, duration: 1, futureClipField: 1 }] }] })
    expect(parsed.sequences[0]).toMatchObject({ futureField: { keep: true }, width: 1920 })
    expect(parsed.sequences[0].clips[0]).toMatchObject({ futureClipField: 1 })
    expect(videoEditDocumentKind.contentSchema.safeParse({ ...empty, sequences: [] }).success).toBe(false)
    expect(videoEditDocumentKind.standaloneFolderNames).toBeNull()
  })
})
