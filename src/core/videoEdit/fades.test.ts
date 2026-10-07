import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { splitVideoEditClip, videoEditDocumentSchema } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { setVideoEditClipFade, videoEditFadeGain, videoEditFadeOpacity } from './fades'

function fixture() {
  const document = createVideoEditDocument('淡化')
  document.media = [{ id: 'media', name: '原路径', kind: 'video', path: 'D:/original.mp4', durationSeconds: 10, width: 1920, height: 1080, hasAudio: true }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'media' }]
  const clip = { ...makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 30, track: 1, duration: 60 }), id: 'clip' }
  document.sequences[0].clips = [clip]
  return { document, clip }
}

describe('淡化手柄（PR）', () => {
  it('画面淡入从第一帧透明线性到满，淡出到最后一帧透明；没有淡化不改不透明度', () => {
    const { clip } = fixture()
    expect(videoEditFadeOpacity(clip, 30)).toBe(1)
    const faded = { ...clip, fadeInFrames: 10, fadeOutFrames: 20 }
    expect(videoEditFadeOpacity(faded, 30)).toBe(0)
    expect(videoEditFadeOpacity(faded, 35)).toBe(.5)
    expect(videoEditFadeOpacity(faded, 40)).toBe(1)
    expect(videoEditFadeOpacity(faded, 89)).toBe(0)
    expect(videoEditFadeOpacity(faded, 79)).toBe(.5)
  })
  it('声音淡化按恒定功率（正弦）随连续时间变化', () => {
    const { clip } = fixture(); const fps = 30
    const faded = { ...clip, fadeInFrames: 15, fadeOutFrames: 15 }
    expect(videoEditFadeGain(faded, 1, fps)).toBe(0)
    expect(videoEditFadeGain(faded, 1.25, fps)).toBeCloseTo(Math.SQRT1_2)
    expect(videoEditFadeGain(faded, 2, fps)).toBe(1)
    expect(videoEditFadeGain(faded, 3, fps)).toBe(0)
  })
  it('拖手柄写入淡化长度，合计不超过片段，拖回 0 去掉字段并通过文档校验', () => {
    const { document, clip } = fixture()
    const withIn = setVideoEditClipFade(clip, 'in', 45)
    expect(withIn.fadeInFrames).toBe(45)
    expect(setVideoEditClipFade(withIn, 'out', 100).fadeOutFrames).toBe(15)
    expect(setVideoEditClipFade(withIn, 'in', -3)).not.toHaveProperty('fadeInFrames')
    document.sequences[0].clips = [withIn]
    expect(() => videoEditDocumentSchema.parse(document)).not.toThrow()
  })
  it('拆分后淡入留在左半段开头，淡出留在右半段结尾', () => {
    const { document, clip } = fixture()
    const sequence = { ...document.sequences[0], clips: [{ ...clip, fadeInFrames: 10, fadeOutFrames: 10 }] }
    const [left, right] = splitVideoEditClip(sequence, 'clip', 60).clips
    expect(left).toMatchObject({ fadeInFrames: 10 }); expect(left).not.toHaveProperty('fadeOutFrames')
    expect(right).toMatchObject({ fadeOutFrames: 10 }); expect(right).not.toHaveProperty('fadeInFrames')
  })
})
