import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createVideoEditTestDocument } from './testFixtures'
import { videoEditComposition, videoEditDocumentSchema, videoEditNestedComposition } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { videoEditTextMediaIdentity } from './textTranscript'
import { bindVideoEditTranscriptCaptions } from './captionSpeechBinding'
import { deleteVideoEditTextRanges, extractVideoEditTextRanges, insertVideoEditTextRanges } from './textEdits'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { createVideoEditSpeechCaptionRetimer } from './captionSpeech'
import { nestVideoEditClips } from './nestedSequences'
import { videoEditNestedCaptionSourceId } from './nestedCaptions'

function fixture() {
  const document = createVideoEditTestDocument('字幕来源'); const sequence = document.sequences[0]
  document.media = [{ id: 'media', name: '口播', path: path.resolve(path.sep, 'voice.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 10, hasAudio: true }]
  document.items = [{ id: 'item', name: '口播', kind: 'audio', mediaId: 'media' }]
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 90 }), id: 'voice' }]
  sequence.textTranscription = { audioDocumentId: 'asr', sources: [{ itemId: 'item', mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item'), silences: [], blocks: ['先打开后台', '查看价格', '然后保存'].map((text, index) => ({ id: `word-${index}`, text, startFrame: index * 1000000, endFrame: (index + 1) * 1000000, granularity: 'word', included: true, locked: false })) }] }
  sequence.captions = bindVideoEditTranscriptCaptions(videoEditComposition(document, sequence.id), [{ id: 'caption', text: '先打开后台查看价格然后保存', start: 0, duration: 90 }])
  return { document, sequence }
}

describe('字幕来源随内容剪辑', () => {
  it('删除中间词后，左右字幕只保留各自口述，独立字幕维持自身语义', () => {
    const { document, sequence } = fixture()
    sequence.captions!.push({ id: 'independent', text: '独立创作', start: 120, duration: 30 })
    const next = deleteVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
    expect(next.sequences[0].captions).toMatchObject([{ text: '先打开后台', start: 0, duration: 30 }, { text: '然后保存', start: 30, duration: 30 }, { id: 'independent', text: '独立创作', start: 120 }])
    expect(next.sequences[0].captions!.slice(0, 2).map(caption => caption.sourceText)).toEqual(['先打开后台', '然后保存'])
    expect(() => videoEditDocumentSchema.parse(next)).not.toThrow()
  })
  it('摘选、插入与片段复制重映射所有词源引用，后续再剪仍正确', () => {
    const { document, sequence } = fixture()
    const excerpt = extractVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
    expect(excerpt.captions).toMatchObject([{ text: '查看价格', start: 0, duration: 30 }])
    expect(excerpt.captions![0].speech!.words.every(word => excerpt.clips.some(clip => clip.id === word.clipId))).toBe(true)
    const inserted = insertVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }], 90)
    expect(inserted.sequences[0].captions!.at(-1)).toMatchObject({ text: '查看价格', start: 90, duration: 30 })
    const clipboard = copyVideoEditClips(document, sequence.id, ['voice'])
    expect(clipboard.captions).toHaveLength(1)
    const pasted = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 120, mode: 'paste' })
    const copied = pasted.captions!.at(-1)!
    expect(copied.speech!.words.every(word => pasted.clips.some(clip => clip.id === word.clipId))).toBe(true)
    expect(copied.speech!.words[0].clipId).not.toBe('voice')
    const recut = deleteVideoEditTextRanges({ ...document, sequences: [pasted] }, sequence.id, [{ from: 150, to: 180 }])
    expect(recut.sequences[0].captions!.slice(1).map(caption => caption.text)).toEqual(['先打开后台', '然后保存'])
    expect(() => videoEditDocumentSchema.parse(recut)).not.toThrow()
  })
  it('人工校对和译文不能按字符比例猜拆，保留修改并标记待复核', () => {
    const { document, sequence } = fixture()
    sequence.captions![0].text = '先进入管理页面，检查定价，保存结果'
    sequence.captions![0].translation = 'Open the dashboard, check the price and save.'
    const next = deleteVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
    for (const caption of next.sequences[0].captions!) {
      expect(caption.text).toBe(sequence.captions![0].text)
      expect(caption.translation).toBe(sequence.captions![0].translation)
      expect(caption.reviewReasons).toEqual(expect.arrayContaining(['text', 'translation']))
    }
  })
  it('内容删减保留排版后的标点策略和换行，不重新塞回识别原文的标点', () => {
    const { document, sequence } = fixture()
    sequence.clips[0].duration = 150
    sequence.textTranscription!.sources[0].blocks = ['先，打开', '后台', '查看价格', '然后', '保存'].map((text, index) => ({ id: `layout-${index}`, text, startFrame: index * 1000000, endFrame: (index + 1) * 1000000, granularity: 'word', included: true, locked: false }))
    sequence.captions = bindVideoEditTranscriptCaptions(videoEditComposition(document, sequence.id), [{ id: 'laid-out', text: '先打开\n后台 查看价格 然后 保存！', start: 0, duration: 150 }])
    const speech = sequence.captions[0].speech!
    speech.words.push({ clipId: 'voice', text: '！', startUs: 4900000, endUs: 4900000, precision: 'estimated' })
    const next = deleteVideoEditTextRanges(document, sequence.id, [{ from: 60, to: 90 }])
    expect(next.sequences[0].captions!.map(caption => caption.text)).toEqual(['先打开\n后台', '然后 保存！'])
    expect(next.sequences[0].captions![0].sourceText).toBe('先，打开后台')
  })
  it('速度、倒放和不同实例按源区间定位，切到词内部明确标记时间复核', () => {
    const { document, sequence } = fixture()
    const faster = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'speed', clipIds: ['voice'], change: { speed: { numerator: 2, denominator: 1 } } })
    expect(faster.captions).toMatchObject([{ start: 0, duration: 45 }])
    const reversed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'speed', clipIds: ['voice'], change: { reverse: true } })
    expect(reversed.captions![0].reviewReasons).toContain('timing')
    const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['voice'], frame: 15 })
    expect(split.captions!.every(caption => caption.reviewReasons?.includes('timing'))).toBe(true)
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [split] })).not.toThrow()
  })
  it('跨片段字幕在无关修改时不拆分，移走一个来源时按实际归属拆分', () => {
    const { sequence } = fixture()
    const right = { ...sequence.clips[0], id: 'second', start: 90 }
    sequence.clips.push(right)
    const caption = sequence.captions![0]
    caption.duration = 180
    caption.speech!.words.push(...caption.speech!.words.map(word => ({ ...word, clipId: 'second' })))
    caption.text += caption.text; caption.speech!.text = caption.text
    expect(createVideoEditSpeechCaptionRetimer(sequence, structuredClone(sequence), new Map())(caption)).toEqual([caption])
    const after = { ...sequence, clips: [sequence.clips[0], { ...right, start: 210 }] }
    const moved = createVideoEditSpeechCaptionRetimer(sequence, after, new Map())(caption)
    expect(moved.map(cue => [cue.start, cue.duration])).toEqual([[0, 90], [210, 90]])
    expect(moved.map(cue => cue.text)).toEqual(['先打开后台查看价格然后保存', '先打开后台查看价格然后保存'])
  })
  it('嵌套时词源随声音进入子序列，在子序列继续删句不残留整句', () => {
    const { document, sequence } = fixture()
    const nested = nestVideoEditClips(document, sequence.id, ['voice'], '嵌套口播')
    expect(nested.document.sequences[0].captions).toHaveLength(0)
    expect(nested.sequence.captions![0].speech!.words.every(word => nested.sequence.clips.some(clip => clip.id === word.clipId))).toBe(true)
    const edited = deleteVideoEditTextRanges(nested.document, nested.sequence.id, [{ from: 30, to: 60 }])
    expect(edited.sequences.find(value => value.id === nested.sequence.id)!.captions!.map(caption => caption.text)).toEqual(['先打开后台', '然后保存'])
    expect(() => videoEditDocumentSchema.parse(edited)).not.toThrow()
  })
  it('剪父序列的嵌套实例时按保留范围投影字幕，不改共享子序列或另一个实例', () => {
    const { document, sequence } = fixture()
    const nested = nestVideoEditClips(document, sequence.id, ['voice'], '嵌套口播')
    const original = structuredClone(nested.sequence)
    const edited = deleteVideoEditTextRanges(nested.document, sequence.id, [{ from: 30, to: 60 }])
    const parent = videoEditComposition(edited, sequence.id)
    expect(parent.clips.flatMap(clip => videoEditNestedComposition(parent, clip)!.captions!.map(caption => caption.text))).toEqual(['先打开后台', '然后保存'])
    expect(edited.sequences.find(value => value.id === nested.sequence.id)).toEqual(original)
    expect(videoEditNestedComposition(parent, { ...nested.clip, start: 180 })!.captions!.map(caption => caption.text)).toEqual(['先打开后台查看价格然后保存'])
    expect(videoEditNestedComposition(parent, parent.clips[0])!.captions).toBe(videoEditNestedComposition(parent, parent.clips[0])!.captions)
    for (const clip of parent.clips) for (const caption of videoEditNestedComposition(parent, clip)!.captions!) expect(original.captions!.some(saved => saved.id === videoEditNestedCaptionSourceId(caption))).toBe(true)
  })
  it('替换声音来源后撤销旧词关联，后续剪辑不能把旧词套到新声音上', () => {
    const { document, sequence } = fixture()
    document.items.push({ ...document.items[0], id: 'replacement' })
    const replaced = { ...sequence, clips: [{ ...sequence.clips[0], itemId: 'replacement', duration: 30 }] }
    replaced.captions = createVideoEditSpeechCaptionRetimer(sequence, replaced, new Map())(sequence.captions![0])
    expect(replaced.captions[0]).toMatchObject({ text: '先打开后台查看价格然后保存', reviewReasons: ['text', 'timing'] })
    expect(replaced.captions[0].speech).toBeUndefined()
    expect(replaced.captions[0].clipId).toBeUndefined()
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [replaced] })).not.toThrow()
    const next = deleteVideoEditTextRanges({ ...document, sequences: [replaced] }, sequence.id, [{ from: 0, to: 15 }])
    expect(next.sequences[0].captions![0].text).toBe('先打开后台查看价格然后保存')
  })
})
