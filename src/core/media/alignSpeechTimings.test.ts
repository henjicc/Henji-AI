import { expect, it } from 'vitest'
import { alignSpeechTimings } from './alignSpeechTimings'
import type { SpeechTimings } from './speechTimings'

function timings(text: string): SpeechTimings { return { granularity: 'char', items: Array.from(text).map((text, index) => ({ text, startMs: index * 100, endMs: (index + 1) * 100 })) } }
it.each([['你好世界', '你好大世界'], ['你好新世界', '你好世界'], ['你好世界', '你好世介'], ['AI，画画！你好 world。', 'AI画画你好world']])('preserves original %s against %s', async (original, recognized) => {
  const result = await alignSpeechTimings(original, timings(recognized))
  expect(result.map(item => item.text).join('')).toBe(original)
  expect(result.every(item => Number.isFinite(item.startMs) && item.endMs >= item.startMs)).toBe(true)
  expect(result.filter(item => item.estimated).every(item => item.confidence === 0)).toBe(true)
})
it('interpolates missing characters between adjacent anchors', async () => {
  expect(await alignSpeechTimings('甲乙丙', { granularity: 'char', items: [{ text: '甲', startMs: 0, endMs: 100 }, { text: '丙', startMs: 300, endMs: 400 }] })).toMatchObject([
    { text: '甲', startMs: 0, endMs: 100, estimated: false }, { text: '乙', startMs: 100, endMs: 300, confidence: 0, estimated: true }, { text: '丙', startMs: 300, endMs: 400, estimated: false },
  ])
})
it('supports cancellation without a product size cap', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(alignSpeechTimings('原文', timings('识别'), controller.signal)).rejects.toThrow()
})
