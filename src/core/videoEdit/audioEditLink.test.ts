import { describe, expect, it } from 'vitest'
import type { AudioEditSubtitleCue } from '../audioEdit/subtitles'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import { remapVideoEditLinkedClip, videoEditLinkedCaptions, videoEditLinkedTimeline } from './audioEditLink'
import { updateVideoEditAudioLinks } from './audioLink'

/*
 * 音频编辑与剪辑的动态链接：链接字幕按字幕段生成、带逐词来源；音频编辑重新剪辑后，片段按原来的源录音位置对回新成品。
 * 采样率 1000、序列 10 帧每秒：成品第 n 帧即 n 毫秒。
 */

const FPS = 10
const clipOf = (overrides: Partial<VideoEditClip> = {}): VideoEditClip => ({
  id: 'voice', itemId: 'item-old', name: '口播', kind: 'audio', track: 0, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', creativeSource: { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 1 }, ...overrides,
} as VideoEditClip)
const cue = (id: string, startFrame: number, endFrame: number, words: string[]): AudioEditSubtitleCue => ({
  id, startFrame, endFrame, text: words.join(''), words: words.map((text, index) => ({ blockId: `${id}-${index}`, text, startFrame: startFrame + index * (endFrame - startFrame) / words.length, endFrame: startFrame + (index + 1) * (endFrame - startFrame) / words.length })),
})

describe('链接字幕', () => {
  it('按片段源范围换算到序列帧，带逐词来源；片段只盖住一部分时只显示盖住的词，保留原字幕 ID 与样式', () => {
    const cues = [cue('a', 0, 1000, ['这是', '我做的']), cue('b', 1200, 2400, ['一个', '工具', '它能'])]
    const whole = videoEditLinkedCaptions(clipOf(), FPS, cues, 1000)
    expect(whole.map(caption => [caption.text, caption.start, caption.duration, caption.linkedCaptionId])).toEqual([['这是我做的', 0, 10, 'a'], ['一个工具它能', 12, 12, 'b']])
    expect(whole[1].speech?.words.map(word => [word.text, word.startUs, word.endUs])).toEqual([['一个', 1200000, 1600000], ['工具', 1600000, 2000000], ['它能', 2000000, 2400000]])
    // 片段从 1.6 秒开始放：b 只剩后两个词；a 不在片段里
    const kept = new Map([['part|b', { id: 'kept-id', style: '' as const, translation: 'it can' }]])
    const part = videoEditLinkedCaptions(clipOf({ id: 'part', start: 50, sourceInUs: 1600000, duration: 8 }), FPS, cues, 1000, kept)
    expect(part.map(caption => [caption.id, caption.text, caption.start, caption.duration, caption.translation])).toEqual([['kept-id', '工具它能', 50, 8, 'it can']])
  })
})

describe('重新剪辑后按词对回', () => {
  // 原成品 = 源 [0,1000) + [2000,4000)；新成品删掉了源 [2500,3000)，又恢复了 [1000,1500)
  const before = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 1000, outputStartFrame: 0, outputEndFrame: 1000 }, { sourceStartFrame: 2000, sourceEndFrame: 4000, outputStartFrame: 1000, outputEndFrame: 3000 }], 1000)
  const after = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 1500, outputStartFrame: 0, outputEndFrame: 1500 }, { sourceStartFrame: 2000, sourceEndFrame: 2500, outputStartFrame: 1500, outputEndFrame: 2000 }, { sourceStartFrame: 3000, sourceEndFrame: 4000, outputStartFrame: 2000, outputEndFrame: 3000 }], 1000)

  it('片段对回原来的源录音位置：中间删掉的内容让它变短，入点跟着词走；整段被剪掉返回 null', () => {
    expect(before.spans).toEqual([0, 1000, 2000, 4000])
    // 放的是原成品 [1000, 3000)，即源 [2000, 4000)：新成品里是 [1500, 3000)，少了删掉的 0.5 秒
    expect(remapVideoEditLinkedClip(clipOf({ sourceInUs: 1000000, duration: 20 }), FPS, before, after)).toEqual({ sourceInUs: 1500000, duration: 15 })
    // 放的是原成品 [1500, 2000)，即源 [2500, 3000)：整段被删
    expect(remapVideoEditLinkedClip(clipOf({ sourceInUs: 1500000, duration: 5 }), FPS, before, after)).toBeNull()
    expect(remapVideoEditLinkedClip(clipOf({ sourceInUs: 0, duration: 10, speed: { numerator: 2, denominator: 1 } }), FPS, before, after)).toBeUndefined()
  })

  it('更新文档：对回片段、换成新成品，重新生成链接字幕，不动别的字幕与后续片段', () => {
    const sequence = { id: 's', name: '序列', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clipOf({ sourceInUs: 1000000, duration: 20 }), clipOf({ id: 'later', kind: 'video', itemId: 'video', start: 40, duration: 10, creativeSource: undefined })],
      captions: [{ id: 'mine', start: 0, duration: 5, text: '手动字幕' }, { id: 'old-linked', clipId: 'voice', linkedCaptionId: 'b', start: 0, duration: 10, text: '旧文字', translation: 'kept' }] } as unknown as VideoEditSequence
    const document = { id: 'v', sequences: [sequence], items: [{ id: 'item-old', mediaId: 'media-old' }], media: [{ id: 'media-old', linkedTimeline: before }] } as unknown as VideoEditDocument
    const cues = [cue('b', 1500, 2400, ['工具', '它能'])]
    const result = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, { timeline: after, cues })
    const next = result.document.sequences[0]
    expect(next.clips.map(clip => [clip.id, clip.itemId, clip.start, clip.duration, clip.sourceInUs])).toEqual([['voice', 'item-new', 0, 15, 1500000], ['later', 'video', 40, 10, 0]])
    expect(next.captions?.map(caption => [caption.id, caption.text, caption.start, caption.duration, caption.translation])).toEqual([['mine', '手动字幕', 0, 5, undefined], ['old-linked', '工具它能', 0, 9, 'kept']])
    expect(result.notices.map(notice => notice.clipId)).toEqual(['voice'])
  })
})
