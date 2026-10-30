import { describe, expect, it } from 'vitest'
import type { AudioEditSubtitleCue } from '../audioEdit/subtitles'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import { remapVideoEditLinkedClip, remapVideoEditLinkedSpeechWord, videoEditCaptionsFromAudioEdit, videoEditLinkedTimeline } from './audioEditLink'
import { updateVideoEditAudioLinks } from './audioLink'
import { reconcileVideoEditTimedContent, retimeVideoEditContent } from './timedContent'

/*
 * 音频编辑与剪辑的动态链接：普通字幕按字幕段一次性生成、带逐词来源；音频编辑重新剪辑后，片段按原来的源录音位置对回新成品。
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

describe('按音频编辑字幕段生成剪辑字幕', () => {
  it('按片段源范围换算到序列帧，带逐词来源；片段只盖住一部分时只显示盖住的词', () => {
    const cues = [cue('a', 0, 1000, ['这是', '我做的']), cue('b', 1200, 2400, ['一个', '工具', '它能'])]
    const whole = videoEditCaptionsFromAudioEdit(clipOf(), FPS, cues, 1000)
    expect(whole.map(caption => [caption.text, caption.start, caption.duration])).toEqual([['这是我做的', 0, 10], ['一个工具它能', 12, 12]])
    expect(whole.every(caption => !('linkedCaptionId' in caption))).toBe(true)
    expect(whole[1].speech?.words.map(word => [word.text, word.startUs, word.endUs])).toEqual([['一个', 1200000, 1600000], ['工具', 1600000, 2000000], ['它能', 2000000, 2400000]])
    // 片段从 1.6 秒开始放：b 只剩后两个词；a 不在片段里
    const part = videoEditCaptionsFromAudioEdit(clipOf({ id: 'part', start: 50, sourceInUs: 1600000, duration: 8 }), FPS, cues, 1000, () => 'part-caption')
    expect(part.map(caption => [caption.id, caption.text, caption.start, caption.duration])).toEqual([['part-caption', '工具它能', 50, 8]])
  })

  it('词中间入点和出点生成的参考已夹到源范围，同一声音刷新不误标待复核', () => {
    const clip = clipOf({ sourceInUs: 250000, duration: 5 })
    const captions = videoEditCaptionsFromAudioEdit(clip, FPS, [cue('a', 0, 1000, ['一', '二'])], 1000)
    expect(captions[0].speech?.words.map(word => [word.startUs, word.endUs])).toEqual([[250000, 500000], [500000, 750000]])
    const timeline = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 3000, outputStartFrame: 0, outputEndFrame: 3000 }], 1000)
    const sequence = { frameRate: { numerator: FPS, denominator: 1 }, clips: [clip], captions } as VideoEditSequence
    const document = { sequences: [sequence], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: timeline }] } as unknown as VideoEditDocument
    const refreshed = updateVideoEditAudioLinks(document, 'audio-doc', 'item-old', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, timeline).document
    expect(refreshed.sequences[0].captions).toEqual(captions)
    expect(refreshed.sequences[0].captions![0].reviewReasons).toBeUndefined()
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
    // 尾点恰好在拼接处，不能把随后恢复的录音算入原片段。
    expect(remapVideoEditLinkedClip(clipOf({ duration: 10 }), FPS, before, after)).toEqual({ sourceInUs: 0, duration: 10 })
    const point = { clipId: 'voice', text: '！', startUs: 2000000, endUs: 2000000, precision: 'estimated' as const }
    expect(remapVideoEditLinkedSpeechWord(point, before, after)).toEqual(point)
    expect(remapVideoEditLinkedSpeechWord({ ...point, startUs: 1500000, endUs: 1500000 }, before, after)).toBeUndefined()
  })

  it('更新文档：对回片段、换成新成品，保留剪辑字幕与后续片段', () => {
    const sequence = { id: 's', name: '序列', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clipOf({ sourceInUs: 1000000, duration: 20 }), clipOf({ id: 'later', kind: 'video', itemId: 'video', start: 40, duration: 10, creativeSource: undefined })],
      captions: [{ id: 'mine', start: 0, duration: 5, text: '手动字幕' }, { id: 'audio-caption', clipId: 'voice', start: 0, duration: 10, text: '旧文字', translation: 'kept' }] } as unknown as VideoEditSequence
    const document = { id: 'v', sequences: [sequence], items: [{ id: 'item-old', mediaId: 'media-old' }], media: [{ id: 'media-old', linkedTimeline: before }] } as unknown as VideoEditDocument
    const result = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, after)
    const next = result.document.sequences[0]
    expect(next.clips.map(clip => [clip.id, clip.itemId, clip.start, clip.duration, clip.sourceInUs])).toEqual([['voice', 'item-new', 0, 15, 1500000], ['later', 'video', 40, 10, 0]])
    expect(next.captions?.map(caption => [caption.id, caption.text, caption.start, caption.duration])).toEqual([['mine', '手动字幕', 0, 5], ['audio-caption', '旧文字', 0, 10]])
    expect(result.notices.map(notice => notice.clipId)).toEqual(['voice'])
  })

  it('剪短后保留字幕成品、对回逐词参考，移动时仍跟随片段', () => {
    const clip = clipOf({ start: 10, sourceInUs: 1000000, duration: 20 })
    const [caption] = videoEditCaptionsFromAudioEdit(clip, FPS, [cue('words', 1000, 3000, ['开场', '删掉', '留下', '结束'])], 1000, () => 'caption')
    caption.duration = 15
    caption.translation = 'Keep authored translation'
    caption.style = ''
    const sequence = { id: 's', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clip], captions: [caption] } as unknown as VideoEditSequence
    const document = { sequences: [sequence], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: before }] } as unknown as VideoEditDocument
    const refreshed = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, after).document
    const next = reconcileVideoEditTimedContent(document, refreshed, [], true).sequences[0]
    expect(next.captions).toHaveLength(1)
    expect(next.captions![0]).toMatchObject({ id: caption.id, start: caption.start, duration: caption.duration, text: caption.text, style: caption.style, translation: caption.translation, reviewReasons: ['timing'] })
    expect(next.captions![0].speech?.words.map(word => [word.text, word.startUs, word.endUs])).toEqual([
      ['开场', 1500000, 2000000], ['留下', 2000000, 2500000], ['结束', 2500000, 3000000],
    ])
    const moved = retimeVideoEditContent(next, { ...next, clips: next.clips.map(value => ({ ...value, start: value.start + 30 })) })
    expect(moved.captions).toHaveLength(1)
    expect(moved.captions![0]).toMatchObject({ id: caption.id, start: caption.start + 30, duration: caption.duration, text: caption.text, speech: next.captions![0].speech })
  })

  it('中间剪掉后解除尾部字幕归属，随后移动和修剪片段都保留字幕成品并标 timing', () => {
    const clip = clipOf()
    const before = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 3000, outputStartFrame: 0, outputEndFrame: 3000 }], 1000)
    const after = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 1000, outputStartFrame: 0, outputEndFrame: 1000 }, { sourceStartFrame: 1500, sourceEndFrame: 3000, outputStartFrame: 1000, outputEndFrame: 2500 }], 1000)
    const captions = videoEditCaptionsFromAudioEdit(clip, FPS, [cue('partial', 2300, 2700, ['部分越界']), cue('tail', 2600, 3000, ['结', '尾'])], 1000)
    captions.push({ id: 'manual', clipId: clip.id, start: 26, duration: 3, text: '手动', reviewReasons: ['text'] })
    const sequence = { id: 's', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clip], captions } as unknown as VideoEditSequence
    const document = { sequences: [sequence], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: before }] } as unknown as VideoEditDocument
    const refreshed = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 2.5, after).document
    const next = reconcileVideoEditTimedContent(document, refreshed, [], true).sequences[0]
    expect(next.clips[0].duration).toBe(25)
    const expected = captions.map(({ clipId: _clipId, speech: _speech, ...caption }) => ({ ...caption, reviewReasons: [...(caption.reviewReasons ?? []), 'timing'] }))
    expect(next.captions).toEqual(expected)
    const moved = retimeVideoEditContent(next, { ...next, clips: [{ ...next.clips[0], start: 30 }] })
    const trimmed = retimeVideoEditContent(next, { ...next, clips: [{ ...next.clips[0], duration: 23 }] })
    expect(moved.captions).toEqual(expected)
    expect(trimmed.captions).toEqual(expected)
  })

  it('删除片段与缩短同时发生时，跨片段字幕复用普通删除规则再更新参考', () => {
    const first = clipOf({ id: 'first', sourceInUs: 1500000, duration: 5 })
    const second = clipOf({ id: 'second', start: 10, sourceInUs: 1000000, duration: 20 })
    const sequence = { id: 's', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [first, second], captions: [{ id: 'across', start: 0, duration: 30, text: '前句后句', speech: { text: '前句后句', aligned: true, words: [
      { clipId: first.id, text: '前句', startUs: 1500000, endUs: 2000000, precision: 'word' },
      { clipId: second.id, text: '后句', startUs: 1000000, endUs: 3000000, precision: 'word' },
    ] } }] } as unknown as VideoEditSequence
    const document = { sequences: [sequence], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: before }] } as unknown as VideoEditDocument
    const deleted = retimeVideoEditContent(sequence, { ...sequence, clips: [second] }).captions![0]
    const refreshed = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, after).document
    const next = reconcileVideoEditTimedContent(document, refreshed, [], true).sequences[0]
    expect(next.captions).toHaveLength(1)
    expect(next.captions![0]).toMatchObject({ text: deleted.text, start: deleted.start, duration: deleted.duration, reviewReasons: ['timing'] })
    expect(next.captions![0].clipId).toBeUndefined()
    expect(next.captions![0].speech).toBeUndefined()
  })
})
