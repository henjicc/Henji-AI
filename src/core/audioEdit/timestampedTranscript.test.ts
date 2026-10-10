import { describe, expect, it } from 'vitest'
import { normalizeTimestampedTranscript } from './timestampedTranscript'
import { ASR_CATALOG, listTimestampedLocalAsr } from './asrCatalog'

describe('带时间转写 DTO（synthetic-negative / 受控毫秒真值）', () => {
  it('保留字级时间，不把整句均分成词', () => {
    const output = normalizeTimestampedTranscript({ text: '你好', segments: [{ text: '你好', startMs: 100, endMs: 900,
      words: [{ text: '你', startMs: 120, endMs: 200 }, { text: '好', startMs: 600, endMs: 800 }] }] }, 1_000, 'character')
    expect(output).toMatchObject({ unit: 'ms', granularity: 'character', words: [{ text: '你', startMs: 120, endMs: 200, granularity: 'character' }, { text: '好', startMs: 600, endMs: 800 }] })
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
  it.each([[-1, 10], [200, 100], [0, 1_001], [NaN, 100], [0, Infinity], [10, 10]])('拒绝非法时间 %s/%s，不夹断掩盖错误', (startMs, endMs) => {
    expect(() => normalizeTimestampedTranscript({ text: '错', segments: [{ text: '错', startMs, endMs }] }, 1_000, 'word')).toThrow('ASR_TIMESTAMP_INVALID')
  })
  it('拒绝超出所属句的词；缺时刻的另一个非法端点同样拒绝', () => {
    expect(() => normalizeTimestampedTranscript({ text: '错', segments: [{ text: '错', startMs: 100, endMs: 300, words: [{ text: '错', startMs: 0, endMs: 200 }] }] }, 1_000, 'word')).toThrow('所属句')
    expect(() => normalizeTimestampedTranscript({ text: '错', segments: [{ text: '错', startMs: -10 }] }, 1_000, 'word')).toThrow('ASR_TIMESTAMP_INVALID')
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
