import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { addLegacyVideoEditTracks } from './testFixtures'
import { buildVideoEditTextTranscription, mergeVideoEditTextTranscription, mapVideoEditTextRange, resolveVideoEditTextRanges, videoEditTranscriptWords } from './textTranscript'
import { deleteVideoEditTextRanges, extractVideoEditTextRanges, insertVideoEditTextRanges } from './textEdits'
import type { AudioEditProjectDocument } from '../audioEdit/types'

function fixture() {
  const document = createVideoEditDocument('口播'); const sequence = document.sequences[0]; addLegacyVideoEditTracks(sequence)
  document.media = [{ id: 'm', name: '口播', kind: 'video', path: 'D:/voice.mp4', width: 1920, height: 1080, hasAudio: true, durationSeconds: 20 }]
  document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'm' }]
  const clip = { ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: 1 }), id: 'picture', duration: 300, sourceComponent: 'video' as const, linkId: 'linked' }
  sequence.clips = [clip, { ...clip, id: 'voice', kind: 'audio', track: 0, sourceComponent: 'audio' }]
  const audio: AudioEditProjectDocument = { id: 'asr', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/mix.wav', audioPath: 'D:/mix.wav', durationFrames: 10000, sampleRate: 1000, channels: 1 }, revision: 1, createdAt: 1, updatedAt: 1, vstEnabled: false, referenceScript: '', suggestions: [], transcript: [
    { id: 'one', text: '嗯，', startFrame: 0, endFrame: 500, granularity: 'word', included: true, locked: false },
    { id: 'two', text: '价格', startFrame: 1000, endFrame: 1500, granularity: 'word', included: true, locked: false },
    { id: 'three', text: '九元。', startFrame: 1500, endFrame: 2000, granularity: 'word', included: true, locked: false },
    { id: 'four', text: '那个', startFrame: 4000, endFrame: 4500, granularity: 'word', included: true, locked: false },
  ] }
  sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [sequence.clips[1]], audio, 0)
  return { document, sequence, audio }
}
describe('source words ↔ timeline', () => {
  it('递归读取两层嵌套声音词源，变帧率、裁入点、速度/倒放与静音遵循源时钟', () => {
    const { document, sequence } = fixture()
    sequence.textTranscription!.sources[0].silences = [{ startFrame: 2000000, endFrame: 3000000 }]
    const middle = createVideoEditSequence('中层'); middle.frameRate = { numerator: 24, denominator: 1 }
    const root = createVideoEditSequence('父层')
    document.items.push({ id: 'inner-item', name: '内层', kind: 'sequence', sequenceId: sequence.id }, { id: 'middle-item', name: '中层', kind: 'sequence', sequenceId: middle.id })
    const base = sequence.clips[1]
    middle.clips = [{ ...base, id: 'inner', itemId: 'inner-item', kind: 'sequence', start: 24, duration: 120, sourceInUs: 1000000, speed: { numerator: 2, denominator: 1 }, linkId: undefined }]
    root.clips = [{ ...base, id: 'outer', itemId: 'middle-item', kind: 'sequence', start: 60, duration: 180, sourceInUs: 0, linkId: undefined }]
    document.sequences.push(middle, root)
    expect(videoEditTranscriptWords(videoEditComposition(document, root.id)).map(word => [word.text, word.from, word.to, word.clipId])).toEqual([['价格', 90, 98, 'outer'], ['九元。', 97, 105, 'outer'], ['那个', 135, 143, 'outer']])
    expect(resolveVideoEditTextRanges(videoEditComposition(document, root.id), { kind: 'text', text: '价格九元' })).toEqual([{ from: 90, to: 105 }])
    expect(resolveVideoEditTextRanges(videoEditComposition(document, root.id), { kind: 'silence' })).toEqual([{ from: 105, to: 120 }])
    middle.clips[0] = { ...middle.clips[0], reverse: true, sourceInUs: 11000000 }
    expect(videoEditTranscriptWords(videoEditComposition(document, root.id)).map(word => word.text)).toEqual(['那个', '九元。', '价格'])
    sequence.tracks.find(track => track.kind === 'audio')!.muted = true
    expect(videoEditTranscriptWords(videoEditComposition(document, root.id))).toEqual([])
  })
  it('字幕对嵌套混音的词级识别可回填词源，父层识别优先且子声音改变后失效', () => {
    const { document, sequence, audio } = fixture(); const root = createVideoEditSequence('字幕父层')
    document.items.push({ id: 'nested-item', name: '口播嵌套', kind: 'sequence', sequenceId: sequence.id })
    root.clips = [{ ...sequence.clips[1], id: 'nested', itemId: 'nested-item', kind: 'sequence', linkId: undefined }]
    document.sequences.push(root)
    const composition = videoEditComposition(document, root.id)
    root.textTranscription = buildVideoEditTextTranscription(composition, root.clips, audio, 0)
    expect(root.textTranscription.sources).toHaveLength(1)
    expect(videoEditTranscriptWords(videoEditComposition(document, root.id)).map(word => [word.text, word.from, word.to])).toEqual([['嗯，', 0, 15], ['价格', 30, 45], ['九元。', 45, 60], ['那个', 120, 135]])
    sequence.clips[1].volume = 0
    expect(videoEditTranscriptWords(videoEditComposition(document, root.id))).toEqual([])
  })
  it('maps normal, fractional speed, reverse and trimmed half-open intervals', () => {
    const { sequence } = fixture(); const clip: VideoEditClip = { ...sequence.clips[1], start: 20, duration: 90, sourceInUs: 1000000, speed: { numerator: 3, denominator: 2 } }
    expect(mapVideoEditTextRange(clip, { startFrame: 1500000, endFrame: 2000000 }, 30)).toEqual({ from: 30, to: 40 })
    expect(mapVideoEditTextRange(clip, { startFrame: 500000, endFrame: 1250000 }, 30)).toEqual({ from: 20, to: 25 })
    expect(mapVideoEditTextRange(clip, { startFrame: 0, endFrame: 1000000 }, 30)).toBeUndefined()
    const reverse = { ...clip, reverse: true as const, sourceInUs: 5500000 }
    expect(mapVideoEditTextRange(reverse, { startFrame: 1500000, endFrame: 2000000 }, 30)).toEqual({ from: 90, to: 100 })
    expect(mapVideoEditTextRange(reverse, { startFrame: 5500000, endFrame: 6000000 }, 30)).toBeUndefined()
  })
  it('clips and speed changes update text without re-recognition; source replacement invalidates old text', () => {
    const { document, sequence } = fixture()
    sequence.clips[1] = { ...sequence.clips[1], sourceInUs: 1000000, duration: 90, speed: { numerator: 2, denominator: 1 } }
    const words = videoEditTranscriptWords(videoEditComposition(document, sequence.id))
    expect(words.map(word => [word.text, word.from, word.to])).toEqual([['价格', 0, 8], ['九元。', 7, 15], ['那个', 45, 53]])
    document.media[0].path = 'D:/different.mp4'
    expect(videoEditTranscriptWords(videoEditComposition(document, sequence.id))).toEqual([])
  })
})
it('resolves assistant exact text across words and occurrences, fillers use voiceover word rules', () => {
  const { document, sequence } = fixture(); const composition = videoEditComposition(document, sequence.id)
  expect(resolveVideoEditTextRanges(composition, { kind: 'text', text: '价格九元' })).toEqual([{ from: 30, to: 60 }])
  expect(resolveVideoEditTextRanges(composition, { kind: 'fillers' })).toEqual([{ from: 0, to: 15 }, { from: 120, to: 135 }])
  expect(() => resolveVideoEditTextRanges(composition, { kind: 'text', text: '不存在' })).toThrow('未匹配')
  expect(() => resolveVideoEditTextRanges(composition, { kind: 'text', text: '价格', occurrence: 1 })).toThrow('未匹配')
  sequence.textTranscription!.sources[0].blocks[0].granularity = 'segment'
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'fillers' })).toEqual([{ from: 120, to: 135 }])
  expect(() => resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'words', ranges: [{ start: 0, end: 0 }] })).toThrow('句级')
})
it('matches English lexical spacing and preserves customized voiceover filler words', () => {
  const { document, sequence, audio } = fixture()
  audio.transcript[1].text = 'price'; audio.transcript[2].text = 'nine'
  audio.batchSettings = { silenceThresholdMs: 800, retainedSilenceMs: 350, noiseDb: -40, trimEdges: false, fillers: ['那个'] }
  sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), [sequence.clips[1]], audio, 0)
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'text', text: 'price nine' })).toEqual([{ from: 30, to: 60 }])
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'fillers' })).toEqual([{ from: 120, to: 135 }])
})
it('selected-range recognition preserves other source words and invalidates silence in refreshed coverage', () => {
  const { document, sequence, audio } = fixture(); const composition = videoEditComposition(document, sequence.id)
  const previous = sequence.textTranscription!
  previous.sources[0].silences = [{ startFrame: 1000000, endFrame: 2000000 }, { startFrame: 5000000, endFrame: 6000000 }]
  audio.source.durationFrames = 1000; audio.transcript = [{ ...audio.transcript[1], text: '新价格', startFrame: 0, endFrame: 500 }]
  const incoming = buildVideoEditTextTranscription(composition, [sequence.clips[1]], audio, 30)
  const merged = mergeVideoEditTextTranscription(previous, incoming)
  expect(merged.sources[0].blocks.map(word => word.text)).toEqual(['嗯，', '新价格', '那个'])
  expect(merged.sources[0].silences).toEqual([{ startFrame: 5000000, endFrame: 6000000 }])
  expect(previous.sources[0].blocks.map(word => word.text)).toEqual(['嗯，', '价格', '九元。', '那个'])
})
it('known background music does not lock dialogue; overlapping unclassified voices are protected', () => {
  const { document, sequence, audio } = fixture(); const composition = videoEditComposition(document, sequence.id)
  const voice = sequence.clips[1]
  const music: VideoEditClip = { ...voice, id: 'music', itemId: 'music', audioRole: 'music' }
  let transcript = buildVideoEditTextTranscription(composition, [voice, music], audio, 0)
  expect(transcript.sources).toHaveLength(1); expect(transcript.sources[0].blocks.every(word => !word.locked)).toBe(true)
  transcript = buildVideoEditTextTranscription(composition, [voice, { ...music, audioRole: undefined }], audio, 0)
  expect(transcript.sources[0].blocks.every(word => word.locked)).toBe(true)
})
it('maps a 30-minute, 500-clip, 12000-word transcript without duplicating source words at edits', () => {
  const { document, sequence } = fixture(); const original = sequence.clips[1]
  document.media[0].durationSeconds = 1800
  sequence.clips = Array.from({ length: 500 }, (_, index) => ({ ...original, id: `clip-${index}`, start: index * 108, duration: 108, sourceInUs: index * 3600000, linkId: undefined }))
  sequence.textTranscription!.sources[0].blocks = Array.from({ length: 12000 }, (_, index) => ({ id: `word-${index}`, text: '词', startFrame: index * 150000, endFrame: index * 150000 + 100000, granularity: 'word', included: true, locked: false }))
  const words = videoEditTranscriptWords(videoEditComposition(document, sequence.id))
  expect(words).toHaveLength(12000); expect(words[0].from).toBe(0); expect(words.at(-1)?.to).toBe(53999)
})
it('batch ripple deletes picture and audio together, maintains transcript source offsets', () => {
  const { document, sequence } = fixture(); const before = structuredClone(document)
  const next = deleteVideoEditTextRanges(document, sequence.id, resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'fillers' }))
  expect(videoEditDocumentSchema.safeParse(next).success).toBe(true)
  expect(document).toEqual(before)
  expect(next.sequences[0].clips.map(clip => [clip.kind, clip.start, clip.duration])).toEqual([['video', 0, 105], ['video', 105, 165], ['audio', 0, 105], ['audio', 105, 165]])
  expect(videoEditTranscriptWords(videoEditComposition(next, sequence.id)).map(word => [word.text, word.from])).toEqual([['价格', 15], ['九元。', 30]])
  sequence.tracks.find(track => track.index === 1)!.locked = true
  expect(() => deleteVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])).toThrow('锁定')
})
it('extracts disjoint ranges into a new compact sequence and inserts at the playhead', () => {
  const { document, sequence } = fixture(); const ranges = [{ from: 30, to: 60 }, { from: 120, to: 135 }]
  const excerpt = extractVideoEditTextRanges(document, sequence.id, ranges, '价格摘选')
  const added = { ...document, sequences: [...document.sequences, excerpt] }
  expect(videoEditDocumentSchema.safeParse(added).success).toBe(true)
  expect(excerpt.name).toBe('价格摘选'); expect(excerpt.id).not.toBe(sequence.id)
  expect(excerpt.clips.map(clip => [clip.kind, clip.start, clip.duration])).toEqual([['video', 0, 30], ['video', 30, 15], ['audio', 0, 30], ['audio', 30, 15]])
  expect(videoEditTranscriptWords(videoEditComposition(added, excerpt.id)).map(word => word.text)).toEqual(['价格', '九元。', '那个'])
  const inserted = insertVideoEditTextRanges(document, sequence.id, ranges, 90)
  expect(videoEditDocumentSchema.safeParse(inserted).success).toBe(true)
  expect(inserted.sequences[0].clips.filter(clip => clip.start === 90)).toHaveLength(2)
  expect(Math.max(...inserted.sequences[0].clips.map(clip => clip.start + clip.duration))).toBe(345)
})
it('unrelated locked material outside an excerpt remains untouched; selected locked partners still refuse', () => {
  const { document, sequence } = fixture()
  const unrelated = { ...sequence.clips[0], id: 'unrelated', track: 31, start: 400, duration: 30, sourceComponent: 'video' as const, linkId: undefined }
  sequence.tracks.push({ id: 'locked-extra', name: '锁定素材', index: 31, kind: 'video', enabled: true, muted: false, solo: false, locked: true })
  sequence.clips.push(unrelated)
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
  const excerpt = extractVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
  expect(excerpt.clips).toHaveLength(2); expect(sequence.clips.at(-1)).toBe(unrelated)
  expect(() => extractVideoEditTextRanges(document, sequence.id, [{ from: 400, to: 415 }])).toThrow('锁定')
})
it('silence requires audio evidence, respects locked speech and retains the voiceover pause duration', () => {
  const { document, sequence, audio } = fixture()
  audio.suggestions = [{ id: 'pause', kind: 'long_silence', title: '停顿', detail: '', startFrame: 2000, endFrame: 4000, blockIds: [], confidence: 'high', status: 'pending' }]
  const sound = [sequence.clips[1]]
  sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), sound, audio, 0)
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'silence' })).toEqual([])
  audio.suggestions[0].evidence = 'audio'
  sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), sound, audio, 0)
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'silence' })).toEqual([{ from: 65, to: 115 }])
  audio.transcript.push({ id: 'locked', text: '保护', startFrame: 2500, endFrame: 3000, included: true, locked: true, granularity: 'word' })
  sequence.textTranscription = buildVideoEditTextTranscription(videoEditComposition(document, sequence.id), sound, audio, 0)
  expect(resolveVideoEditTextRanges(videoEditComposition(document, sequence.id), { kind: 'silence' })).toEqual([])
})
