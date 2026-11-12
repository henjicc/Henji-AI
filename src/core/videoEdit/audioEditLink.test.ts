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

  it('更新文档：对回片段、换成新成品，片段上的字幕跟着声音缩短，独立字幕与后续片段不动', () => {
    const sequence = { id: 's', name: '序列', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clipOf({ sourceInUs: 1000000, duration: 20 }), clipOf({ id: 'later', kind: 'video', itemId: 'video', start: 40, duration: 10, creativeSource: undefined })],
      captions: [{ id: 'mine', start: 0, duration: 5, text: '手动字幕' }, { id: 'audio-caption', clipId: 'voice', start: 0, duration: 10, text: '旧文字', translation: 'kept' }] } as unknown as VideoEditSequence
    const document = { id: 'v', sequences: [sequence], items: [{ id: 'item-old', mediaId: 'media-old' }], media: [{ id: 'media-old', linkedTimeline: before }] } as unknown as VideoEditDocument
    const result = updateVideoEditAudioLinks(document, 'audio-doc', 'item-new', { type: 'document', docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision: 2 }, 3, after)
    const next = result.document.sequences[0]
    expect(next.clips.map(clip => [clip.id, clip.itemId, clip.start, clip.duration, clip.sourceInUs])).toEqual([['voice', 'item-new', 0, 15, 1500000], ['later', 'video', 40, 10, 0]])
    // 片段上的手动字幕原来盖住源 [2000,3000)，其中 [2500,3000) 被删：跟着缩到一半，没有逐词依据所以请用户复核时间
    expect(next.captions?.map(caption => [caption.id, caption.text, caption.start, caption.duration, caption.reviewReasons, caption.translation])).toEqual([['mine', '手动字幕', 0, 5, undefined, undefined], ['audio-caption', '旧文字', 0, 5, ['timing'], 'kept']])
    expect(result.notices.map(notice => notice.clipId)).toEqual(['voice'])
  })

  it('删掉中间一个词：没手改的文字按剩下的词重写，首尾跟着声音前移并保留余量，样式和译文保留，之后仍跟随片段', () => {
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
    // 字幕原来止于成品 2.5 秒（源 3500）；删掉源 [2500,3000) 后止于新成品 2.5 秒，即节目第 20 帧
    expect(next.captions![0]).toMatchObject({ id: caption.id, start: 10, duration: 10, text: '开场留下结束', style: caption.style, translation: caption.translation, reviewReasons: ['translation'] })
    expect(next.captions![0].speech?.words.map(word => [word.text, word.startUs, word.endUs])).toEqual([
      ['开场', 1500000, 2000000], ['留下', 2000000, 2500000], ['结束', 2500000, 3000000],
    ])
    const moved = retimeVideoEditContent(next, { ...next, clips: next.clips.map(value => ({ ...value, start: value.start + 30 })) })
    expect(moved.captions).toHaveLength(1)
    expect(moved.captions![0]).toMatchObject({ id: caption.id, start: 40, duration: 10, text: '开场留下结束', speech: next.captions![0].speech })
  })

  it('中间剪掉一段后，后面的字幕整体前移，逐词参考与手改标记照旧，之后仍跟随片段移动', () => {
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
    // 源 [1000,1500) 被删：后面的字幕都前移 5 帧，词也跟着移，不需要复核
    const shift = (us: number): number => us - 500000
    const expected = captions.map(caption => ({ ...caption, start: caption.start - 5, ...(caption.speech ? { speech: { ...caption.speech, words: caption.speech.words.map(word => ({ ...word, startUs: shift(word.startUs), endUs: shift(word.endUs) })) } } : {}) }))
    expect(next.captions).toEqual(expected)
    const moved = retimeVideoEditContent(next, { ...next, clips: [{ ...next.clips[0], start: 30 }] })
    expect(moved.captions?.map(caption => caption.start)).toEqual(expected.map(caption => caption.start + 30))
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
    // 删除片段那一侧按普通删除规则只剩“后句”；后句所在片段按词对回后，字幕跟着缩短，词被剪掉一半所以复核时间
    expect(next.captions![0]).toMatchObject({ text: deleted.text, start: 10, duration: 15, reviewReasons: ['timing'], clipId: 'second' })
    expect(next.captions![0].speech?.words.map(word => [word.text, word.startUs, word.endUs, word.precision])).toEqual([['后句', 1500000, 3000000, 'estimated']])
  })
})

describe('口播删句与恢复后剪辑字幕跟着更新', () => {
  // 原成品 = 源 [0,3000)，三句各 1 秒；新成品删掉第二句（源 [1000,2000)）
  const whole = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 3000, outputStartFrame: 0, outputEndFrame: 3000 }], 1000)
  const cut = videoEditLinkedTimeline([{ sourceStartFrame: 0, sourceEndFrame: 1000, outputStartFrame: 0, outputEndFrame: 1000 }, { sourceStartFrame: 2000, sourceEndFrame: 3000, outputStartFrame: 1000, outputEndFrame: 2000 }], 1000)
  const source = (revision: number) => ({ type: 'document' as const, docRef: { docId: 'audio-doc', path: 'D:/a.hjaud' }, revision })
  const documentOf = (captions: VideoEditSequence['captions'], timeline: typeof whole, clip = clipOf()) => ({ sequences: [{ id: 's', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clip], captions }], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: timeline }] }) as unknown as VideoEditDocument
  const cues = [cue('a', 0, 1000, ['第一', '句']), cue('b', 1000, 2000, ['第二', '句']), cue('c', 2000, 3000, ['第三', '句'])]

  it('删掉的句子字幕移除，后面的前移；手改的文字和样式保留，不标待复核', () => {
    const captions = videoEditCaptionsFromAudioEdit(clipOf(), FPS, cues, 1000)
    captions[2] = { ...captions[2], text: '剪辑里改过的第三句', style: '' }
    const next = updateVideoEditAudioLinks(documentOf(captions, whole), 'audio-doc', 'item-old', source(2), 2, cut).document.sequences[0]
    expect(next.clips[0].duration).toBe(20)
    expect(next.captions?.map(caption => [caption.id, caption.text, caption.start, caption.duration, caption.reviewReasons])).toEqual([
      [captions[0].id, '第一句', 0, 10, undefined], [captions[2].id, '剪辑里改过的第三句', 10, 10, undefined],
    ])
    expect(next.captions![1].style).toBe('')
  })

  it('同一句里删掉一个词：手改过的文字不重写，标正文待复核', () => {
    const [caption] = videoEditCaptionsFromAudioEdit(clipOf(), FPS, [cue('all', 0, 3000, ['甲', '乙', '丙'])], 1000)
    const next = updateVideoEditAudioLinks(documentOf([{ ...caption, text: '手改的整句' }], whole), 'audio-doc', 'item-old', source(2), 2, cut).document.sequences[0]
    expect(next.captions).toHaveLength(1)
    expect(next.captions![0]).toMatchObject({ text: '手改的整句', start: 0, duration: 20, reviewReasons: ['text'] })
    expect(next.captions![0].speech?.words.map(word => word.text)).toEqual(['甲', '丙'])
  })

  it('恢复删掉的句子时按口播字幕段补回；片段上原来没有口播字幕的不补', () => {
    const clip = clipOf({ duration: 20 })
    const kept = videoEditCaptionsFromAudioEdit(clip, FPS, [cue('a', 0, 1000, ['第一', '句']), cue('c', 1000, 2000, ['第三', '句'])], 1000)
    const restored = updateVideoEditAudioLinks(documentOf(kept, cut, clip), 'audio-doc', 'item-old', source(3), 3, whole, cues).document.sequences[0]
    expect(restored.clips[0].duration).toBe(30)
    expect(restored.captions?.map(caption => [caption.text, caption.start, caption.duration])).toEqual([['第一句', 0, 10], ['第二句', 10, 10], ['第三句', 20, 10]])
    const bare = updateVideoEditAudioLinks(documentOf([], cut, clip), 'audio-doc', 'item-old', source(3), 3, whole, cues).document.sequences[0]
    expect(bare.captions).toEqual([])
  })

  it('恢复中间删掉的句子后片段被同轨后面的片段挡住：补回恢复的句子，句尾落到片段外的字幕（含手改）移到新位置并标时间待复核，不删也不与补回的重叠', () => {
    const clip = clipOf({ duration: 20 })
    const blocker = clipOf({ id: 'next', itemId: 'other', start: 25, duration: 10, creativeSource: undefined })
    const kept = videoEditCaptionsFromAudioEdit(clip, FPS, [cue('a', 0, 1000, ['第一', '句']), cue('c', 1000, 2000, ['第三', '句'])], 1000)
    kept[1] = { ...kept[1], text: '手改的第三句' }
    const document = { sequences: [{ id: 's', frameRate: { numerator: FPS, denominator: 1 }, tracks: [], annotations: [], clips: [clip, blocker], captions: kept }], items: [{ id: 'item-old', mediaId: 'm' }], media: [{ id: 'm', linkedTimeline: cut }] } as unknown as VideoEditDocument
    const next = updateVideoEditAudioLinks(document, 'audio-doc', 'item-old', source(3), 3, whole, cues).document.sequences[0]
    expect(next.clips.find(value => value.id === 'voice')?.duration).toBe(25)
    expect(next.captions?.map(caption => [caption.text, caption.start, caption.duration])).toEqual([['第一句', 0, 10], ['第二句', 10, 10], ['手改的第三句', 20, 5]])
    const tail = next.captions!.find(caption => caption.id === kept[1].id)!
    expect(tail.reviewReasons).toEqual(['timing'])
    expect(tail.speech).toBeUndefined()
    const sorted = [...next.captions!].sort((a, b) => a.start - b.start)
    expect(sorted.every((caption, index) => index === 0 || sorted[index - 1].start + sorted[index - 1].duration <= caption.start)).toBe(true)
  })
})
