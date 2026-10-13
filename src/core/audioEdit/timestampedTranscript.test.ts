import { describe, expect, it } from 'vitest'
import { normalizeTimestampedTranscript, audioEditTranscriptBlocks } from './timestampedTranscript'
import { ASR_CATALOG, listTimestampedLocalAsr } from './asrCatalog'
import { parseGroqTranscription } from '../../../packages/ai-sdk/src/capabilities/speech-recognition/groq/parse'

describe('带时间转写 DTO（synthetic-negative / 受控毫秒真值）', () => {
  it('保留字级时间，不把整句均分成词', () => {
    const output = normalizeTimestampedTranscript({ text: '你好', segments: [{ text: '你好', startMs: 100, endMs: 900,
      words: [{ text: '你', startMs: 120, endMs: 200 }, { text: '好', startMs: 600, endMs: 800 }] }] }, 1_000, 'character')
    expect(output).toMatchObject({ unit: 'ms', granularity: 'character', words: [{ text: '你', startMs: 120, endMs: 200, granularity: 'character' }, { text: '好', startMs: 600, endMs: 800 }] })
    expect(audioEditTranscriptBlocks(output, 1000)).toMatchObject([{ text: '你', startFrame: 120, endFrame: 200, granularity: 'word' }, { text: '好', startFrame: 600, endFrame: 800, granularity: 'word' }])
  })
  it('句级与仅文本保持粗粒度和缺时间', () => {
    expect(normalizeTimestampedTranscript({ text: '句子', segments: [{ text: '句子', startMs: 0, endMs: 900 }] }, 1_000, 'word'))
      .toMatchObject({ granularity: 'segment', words: [], segments: [{ timing: 'coarse', startMs: 0, endMs: 900 }] })
    expect(normalizeTimestampedTranscript({ text: '没有时间' }, 1_000, 'word'))
      .toMatchObject({ granularity: 'none', words: [], segments: [{ startMs: null, endMs: null, timing: 'missing' }] })
  })
  it('缺单端时间的词仍保留文本，并明确为混合粒度', () => {
    expect(normalizeTimestampedTranscript({ text: '你好', segments: [{ text: '你好', startMs: 0, endMs: 900,
      words: [{ text: '你', startMs: 10, endMs: 80 }, { text: '好', startMs: 100 }] }] }, 1_000, 'word'))
      .toMatchObject({ granularity: 'mixed', words: [{ timing: 'precise' }, { text: '好', startMs: null, endMs: null, timing: 'missing' }] })
  })
  it.each([[-1, 10], [200, 100], [0, 1_041], [NaN, 100], [0, Infinity], [10, 10]])('拒绝非法时间 %s/%s，不夹断掩盖错误', (startMs, endMs) => {
    expect(() => normalizeTimestampedTranscript({ text: '错', segments: [{ text: '错', startMs, endMs }] }, 1_000, 'word')).toThrow('ASR_TIMESTAMP_INVALID')
  })
  it('保留 SDK 跨句词精确时间；缺时刻的另一个非法端点同样拒绝', () => {
    expect(normalizeTimestampedTranscript({ text: '词', segments: [{ text: '词', startMs: 100, endMs: 300, words: [{ text: '词', startMs: 0, endMs: 200 }] }] }, 1_000, 'word').words[0]).toMatchObject({ startMs: 0, endMs: 200 })
    expect(() => normalizeTimestampedTranscript({ text: '错', segments: [{ text: '错', startMs: -10 }] }, 1_000, 'word')).toThrow('ASR_TIMESTAMP_INVALID')
  })
  it('接受 Groq 官方字段构造夹具中的跨句词及 20ms 量化超长，保留词采样时间', () => {
    const dto = parseGroqTranscription({ text: '你好', duration: 1.02,
      segments: [{ text: '你', start: 0, end: .5 }, { text: '好', start: .5, end: 1.02 }],
      words: [{ word: '你', start: .1, end: .52 }, { word: '好', start: .52, end: 1.02 }] })
    const output = normalizeTimestampedTranscript(dto, 1000, 'word')
    expect(output.words.map(word => [word.startMs, word.endMs])).toEqual([[100, 520], [520, 1000]])
    expect(audioEditTranscriptBlocks(output, 1000).map(block => [block.startFrame, block.endFrame])).toEqual([[100, 520], [520, 1000]])
  })
  it('TTS、仅文本、远端输入和未配置模型均不能成为候选', () => {
    const candidates = listTimestampedLocalAsr((provider) => provider === 'bailian')
    expect(candidates).toHaveLength(5)
    expect(candidates.every((entry) => entry.descriptor.kind === 'speech-recognition' && entry.localAudio && entry.descriptor.features?.includes('timestamps'))).toBe(true)
    expect(candidates.map((entry) => entry.descriptor.modelId)).not.toContain('qwen3-asr-flash')
    expect(listTimestampedLocalAsr(() => false)).toEqual([])
    expect(ASR_CATALOG.find((entry) => entry.descriptor.id.startsWith('volcengine.'))?.localAudio).toBe(false)
  })
})
