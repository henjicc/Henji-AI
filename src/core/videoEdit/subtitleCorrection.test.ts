import { describe, expect, it, vi } from 'vitest'
import { createVideoEditSequence, type VideoEditClip, type VideoEditSequence } from './document'
import { buildSubtitleCorrectionBatches, estimateSubtitleCorrectionTokens, materializeSubtitleCorrection, subtitleCorrectionBudgetsSchema, validateSubtitleCorrectionCues, videoEditSubtitleCorrectionSource } from './subtitleCorrection'

function fixture(count = 3, wordCount = 6): VideoEditSequence {
  const sequence = createVideoEditSequence('校对')
  const clip: VideoEditClip = { id: 'voice', name: '声音', itemId: 'item', kind: 'audio', track: 0, start: 0, duration: count * wordCount * 3, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  sequence.clips = [clip]
  sequence.captions = Array.from({ length: count }, (_, caption) => {
    const words = Array.from({ length: wordCount }, (_, word) => ({ clipId: clip.id, text: `字${word}`, startUs: (caption * wordCount + word) * 100000, endUs: (caption * wordCount + word + 1) * 100000, precision: 'word' as const }))
    const text = words.map(word => word.text).join('')
    return { id: `caption-${caption}`, start: caption * wordCount * 3, duration: wordCount * 3, text, speech: { text, aligned: true, words } }
  })
  return sequence
}
const budgets = () => subtitleCorrectionBudgetsSchema.parse({ inputTokens: 3500, outputTokens: 1800, contextTokens: 150 })
const plan = (sequence = fixture()) => buildSubtitleCorrectionBatches(videoEditSubtitleCorrectionSource(sequence).groups, budgets())
const unchanged = (batch: ReturnType<typeof plan>[number]) => batch.groups.map(group => ({ startWord: group.startWord, endWord: group.endWord, text: group.caption.text }))

describe('按输入输出预算校对字幕', () => {
  it('长字幕完整分批，核心词恰好覆盖一次，上下文有界且输入输出都满足预算', () => {
    const sequence = fixture(600, 8); const started = performance.now()
    const source = videoEditSubtitleCorrectionSource(sequence); const batches = buildSubtitleCorrectionBatches(source.groups, budgets())
    expect(batches.length).toBeGreaterThan(1)
    const indices = batches.flatMap(batch => batch.groups.flatMap(group => group.words.map(word => word.index)))
    expect(indices).toEqual(Array.from({ length: 4800 }, (_, index) => index))
    expect(new Set(indices).size).toBe(4800)
    expect(batches.every(batch => batch.estimatedInputTokens <= 3500 && batch.estimatedOutputTokens <= 1800)).toBe(true)
    expect(batches[1].packet.words[0].index).toBeLessThan(batches[1].packet.core.startWord)
    expect(batches[1].packet.words.at(-1)!.index).toBeGreaterThan(batches[1].packet.core.endWord)
    expect(batches.flatMap(batch => batch.groups.map(group => group.caption.id))).toHaveLength(600)
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') process.stdout.write(JSON.stringify({ captions: 600, words: 4800, batchCount: batches.length, fullCaptionAndSpeechEstimatedTokens: estimateSubtitleCorrectionTokens(JSON.stringify(sequence.captions)), peakPacketEstimatedInputTokens: Math.max(...batches.map(batch => batch.estimatedInputTokens)), peakEstimatedOutputTokens: Math.max(...batches.map(batch => batch.estimatedOutputTokens)), plannerMs: Math.round((performance.now() - started) * 100) / 100 }) + '\n')
  })
  it('规则复用而术语只随局部文字和已知错词出现，不重复发送无关大词表', () => {
    const sequence = fixture(30); sequence.captions![0].text = '瑞克字1字2字3字4字5'; sequence.captions![0].speech!.text = sequence.captions![0].text; sequence.captions![0].speech!.words[0].text = '瑞克'
    const source = videoEditSubtitleCorrectionSource(sequence)
    const batches = buildSubtitleCorrectionBatches(source.groups, budgets(), '保留口语', [{ term: 'React', variants: ['瑞克'] }, { term: '无关术语', variants: [] }])
    expect(batches[0].packet.glossary).toEqual([{ term: 'React', variants: ['瑞克'] }])
    expect(batches.at(-1)!.packet.glossary).toEqual([])
    expect(batches.every(batch => batch.packet.rules === '保留口语')).toBe(true)
    const short = fixture(1, 1); short.captions![0].text = 'AE'; short.captions![0].speech!.text = 'AE'; short.captions![0].speech!.words[0].text = 'AE'
    const fullName = 'Adobe After Effects'
    const glossaryBatch = buildSubtitleCorrectionBatches(videoEditSubtitleCorrectionSource(short).groups, budgets(), '', [{ term: fullName, variants: ['AE'] }])[0]
    expect(validateSubtitleCorrectionCues(glossaryBatch, [{ startWord: 0, endWord: 0, text: fullName }], 1800)[0].text).toBe(fullName)
  })
  it('人工改字、无词源和无法定位的整条字幕受到保护，不能漏掉坏词后继续校对', () => {
    const sequence = fixture(5)
    sequence.captions![0].text = '人工修改'
    delete sequence.captions![1].speech
    sequence.captions![2].speech!.words[2].clipId = 'missing'
    sequence.captions![3].speech!.aligned = false
    const source = videoEditSubtitleCorrectionSource(sequence)
    expect(source.groups.map(group => group.caption.id)).toEqual(['caption-4'])
    expect(source.groups[0].startWord).toBe(0)
    expect(source.protectedCaptions.map(value => value.reason)).toEqual(['authored_text', 'no_word_source', 'unreliable_timing', 'unaligned_source'])
  })
  it('单条字幕或规则超过预算时明确拒绝，不静默删除内容；较大预算可继续', () => {
    const source = videoEditSubtitleCorrectionSource(fixture(1, 180))
    expect(() => buildSubtitleCorrectionBatches(source.groups, budgets())).toThrow('超过输入或输出预算')
    expect(buildSubtitleCorrectionBatches(source.groups, { inputTokens: 20000, outputTokens: 20000, contextTokens: 150 })).toHaveLength(1)
    expect(() => buildSubtitleCorrectionBatches(videoEditSubtitleCorrectionSource(fixture(1)).groups, budgets(), '规'.repeat(4000))).toThrow('超过输入或输出预算')
  })
  it('漏词、重复、乱序、跨字幕、上下文及伪造时间都拒绝，修正后同批可通过', () => {
    const batch = plan()[0]; const valid = unchanged(batch)
    const invalid = [valid.slice(0, -1), [valid[0], ...valid], [...valid].reverse(), [{ ...valid[0], startWord: valid[0].startWord + 1 }, ...valid.slice(1)], [{ ...valid[0], endWord: valid[1].endWord }, ...valid.slice(2)], valid.map((cue, index) => index ? cue : { ...cue, startFrame: 0 })]
    for (const cues of invalid) expect(() => validateSubtitleCorrectionCues(batch, cues, 6000)).toThrow()
    expect(validateSubtitleCorrectionCues(batch, valid, 6000)).toEqual(valid)
    const later = plan(fixture(50))[1]
    expect(() => validateSubtitleCorrectionCues(later, [{ ...unchanged(later)[0], startWord: later.packet.words[0].index }, ...unchanged(later).slice(1)], 6000)).toThrow('上下文')
  })
  it('时间由来源词生成，拆分保留样式和词源，译文保留并标记复核而不猜拆', () => {
    const sequence = fixture(1); const original = sequence.captions![0]; original.translation = 'Full original translation'
    const batch = plan(sequence)[0]; let serial = 0
    const cues = [{ startWord: 0, endWord: 2, text: '修正前三词' }, { startWord: 3, endWord: 5, text: '修正后三词' }]
    const result = materializeSubtitleCorrection(batch, cues, () => `new-${++serial}`)
    expect(result.map(caption => [caption.id, caption.start, caption.duration])).toEqual([['caption-0', 0, 9], ['new-1', 9, 9]])
    expect(result.map(caption => caption.speech!.words.length)).toEqual([3, 3])
    expect(result.every(caption => caption.translation === original.translation && caption.reviewReasons?.includes('translation'))).toBe(true)
    expect(original.text).toBe('字0字1字2字3字4字5'); expect(original.speech!.words).toHaveLength(6)
  })
  it('未修改的整句保持原时间、译文与对象，不生成新ID；过度扩写会被拒绝', () => {
    const batch = plan(fixture(1))[0]; const ids = vi.fn(() => 'unused')
    expect(materializeSubtitleCorrection(batch, unchanged(batch), ids)[0]).toBe(batch.groups[0].caption)
    expect(ids).not.toHaveBeenCalled()
    expect(() => materializeSubtitleCorrection(batch, [{ startWord: 0, endWord: 5, text: '凭空补句'.repeat(100) }], ids)).toThrow('扩写')
    expect(ids).not.toHaveBeenCalled()
  })
  it('重叠词时间拒绝不可靠拆分，但保留整句可以恢复', () => {
    const sequence = fixture(1); sequence.captions![0].speech!.words[2].endUs = 350000
    const batch = plan(sequence)[0]
    expect(() => materializeSubtitleCorrection(batch, [{ startWord: 0, endWord: 2, text: '前三词' }, { startWord: 3, endWord: 5, text: '后三词' }], () => 'new')).toThrow('时间重叠')
    expect(materializeSubtitleCorrection(batch, unchanged(batch), () => 'new')[0]).toBe(sequence.captions![0])
  })
  it('变速和倒放沿正式源时间换算，字幕整数帧范围保持有效', () => {
    const sequence = fixture(1); sequence.clips[0].speed = { numerator: 2, denominator: 1 }; sequence.clips[0].reverse = true; sequence.clips[0].sourceInUs = 600000; sequence.clips[0].duration = 9; sequence.captions![0].duration = 9
    const batch = plan(sequence)[0]
    expect(batch.groups[0].words.map(word => word.text)).toEqual(['字5', '字4', '字3', '字2', '字1', '字0'])
    const result = materializeSubtitleCorrection(batch, [{ startWord: 0, endWord: 5, text: '保留倒放区间' }], () => 'new')
    expect(result[0]).toMatchObject({ start: 0, duration: 9 })
  })
})
