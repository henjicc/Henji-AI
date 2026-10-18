import { describe, expect, it } from 'vitest'
import { findTranscriptSearchRanges, normalizeTranscriptSearch } from '../media/transcriptSearch'
import { createVideoEditTestDocument } from './testFixtures'
import { createVideoEditSequence, videoEditComposition } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { queryVideoEditTranscript } from './transcriptQuery'
import { resolveVideoEditTextRanges, videoEditTextMediaIdentity } from './textTranscript'

function fixture() {
  const document = createVideoEditTestDocument('转录检索'); const sequence = document.sequences[0]
  document.media = [{ id: 'm', name: '原片', path: 'D:/source.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 20, hasAudio: true }]
  document.items = [{ id: 'item', name: '原片', kind: 'video', mediaId: 'm' }]
  const clip = { ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, track: sequence.tracks.find(track => track.kind === 'video')!.index, duration: 300 }), id: 'picture', sourceComponent: 'video' as const, linkId: 'linked' }
  sequence.clips = [clip, { ...clip, id: 'voice', kind: 'audio', sourceComponent: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index }]
  sequence.textTranscription = { audioDocumentId: 'asr', sources: [{ itemId: 'item', mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, sequence.id), 'item'), silences: [], blocks: ['打开，', '后台。', '打开', '后台。', '康复UI。'].map((text, i) => ({ id: `w${i}`, text, startFrame: i * 500000, endFrame: (i + 1) * 500000, granularity: 'word', included: true, locked: false })) }] }
  return { document, sequence, composition: () => videoEditComposition(document, sequence.id) }
}

describe('局部转录检索与精确来源', () => {
  it('规范化标点、全半角、英文大小写，保留原文与整词边界', () => {
    expect(normalizeTranscriptSearch('ＡＩ，Open　后台！')).toBe('aiopen后台')
    expect(findTranscriptSearchRanges([{ text: 'ＡＩ，' }, { text: 'Open 后台。' }], 'ai open，后台')).toEqual([{ start: 0, end: 1 }])
    expect(() => findTranscriptSearchRanges([], '，。')).toThrow('文字或数字')
    expect(findTranscriptSearchRanges([{ text: '重复重复' }], '重复')).toEqual([{ start: 0, end: 0 }])
  })
  it('重复句分别返回，源微秒与半开序列帧保留，文本执行复用相同检索语义', () => {
    const { composition } = fixture()
    const matches = queryVideoEditTranscript(composition(), { text: '打开后台', source: 'asr' })
    expect(matches).toMatchObject([{ text: '打开，后台。', from: 30, to: 60, sourceRange: { startUs: 0, endUs: 1000000 }, itemId: 'item', clipId: 'voice', editable: true }, { text: '打开后台。', from: 60, to: 90, editable: true }])
    expect(resolveVideoEditTextRanges(composition(), { kind: 'text', text: '打开，后台', occurrence: 1 })).toEqual([{ from: 60, to: 90 }])
    expect(queryVideoEditTranscript(composition(), { text: '后台打开' })).toEqual([])
  })
  it('校对术语可命中字幕，但句级字幕不能冒充原始词时间', () => {
    const { sequence, composition } = fixture()
    sequence.captions = [{ id: 'corrected', clipId: 'picture', start: 90, duration: 15, text: 'ComfyUI' }]
    expect(queryVideoEditTranscript(composition(), { text: 'ｃｏｍｆｙｕｉ' })).toMatchObject([{ text: 'ComfyUI', source: 'caption', precision: 'caption', editable: false, from: 90, to: 105 }])
    expect(queryVideoEditTranscript(composition(), { text: '康复UI', source: 'asr' })).toMatchObject([{ source: 'asr', precision: 'word', editable: true }])
  })
  it('限定视频片段时包含其链接声音，素材和半开时间范围过滤正确', () => {
    const { composition } = fixture()
    expect(queryVideoEditTranscript(composition(), { clipId: 'picture', itemId: 'item', text: '打开后台', from: 60, to: 90 })).toMatchObject([{ from: 60, to: 90 }])
    expect(() => queryVideoEditTranscript(composition(), { clipId: 'missing' })).toThrow('不属于')
    expect(() => queryVideoEditTranscript(composition(), { itemId: 'missing' })).toThrow('不属于')
  })
  it('句级、受保护词与锁轨命中可读但不可直接剪', () => {
    const { sequence, composition } = fixture()
    sequence.textTranscription!.sources[0].blocks[0].granularity = 'segment'
    expect(queryVideoEditTranscript(composition(), { text: '打开后台', source: 'asr' })[0]).toMatchObject({ precision: 'segment', editable: false })
    sequence.textTranscription!.sources[0].blocks[0].granularity = 'word'
    sequence.textTranscription!.sources[0].blocks[0].locked = true
    expect(queryVideoEditTranscript(composition(), { text: '打开后台', source: 'asr' })[0].editable).toBe(false)
    sequence.tracks.find(track => track.kind === 'video')!.locked = true
    expect(queryVideoEditTranscript(composition(), { text: '打开后台', source: 'asr' }).every(match => !match.editable)).toBe(true)
  })
  it('嵌套、倒放和变速复用原映射，仍返回叶子素材及来源时间', () => {
    const { document, sequence, composition } = fixture()
    const parent = createVideoEditSequence('嵌套')
    document.items.push({ id: 'nested-item', name: '嵌套', kind: 'sequence', sequenceId: sequence.id })
    parent.clips = [{ ...sequence.clips[1], id: 'nested', kind: 'sequence', itemId: 'nested-item', start: 0, duration: 150, sourceInUs: 0, speed: { numerator: 2, denominator: 1 }, linkId: undefined }]
    document.sequences.push(parent)
    const first = queryVideoEditTranscript(videoEditComposition(document, parent.id), { text: '打开后台', itemId: 'item', source: 'asr' })[0]
    expect(first).toMatchObject({ from: 15, to: 30, clipId: 'nested', itemId: 'item', sourceRange: { startUs: 0, endUs: 1000000 } })
    sequence.clips[1].reverse = true; sequence.clips[1].sourceInUs = 2500000
    expect(queryVideoEditTranscript(composition(), { text: '康复UI', source: 'asr' })[0]).toMatchObject({ from: 30, to: 45, sourceRange: { startUs: 2000000, endUs: 2500000 } })
  })
})
