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

function lcsLength(a: string[], b: string[]): number {
  let row = new Uint32Array(b.length + 1)
  for (const char of a) {
    const next = new Uint32Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) next[j] = char === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1])
    row = next
  }
  return row[b.length]
}

it('agrees with an independent exact oracle on omissions, repeats, terms, mixed digits and seeded edits', async () => {
  const pairs = [
    ['开始打开后台再打开后台结束', '开始打开后台额外补充再打开后台结束'],
    ['请用Henji AI 2.0修改', '请用Henji AL 2.1修改'],
    ['ＡＩ第２项2026年三分钟', 'ai第2项2026年3分钟'],
    ['甲乙丙丁戊己', '戊己甲乙丙丁'],
    ['甲乙'.repeat(180), '乙甲'.repeat(140)],
    ['甲'.repeat(1100) + '独特锚点终' + '乙'.repeat(1100), '乙'.repeat(1100) + '独特锚点终' + '甲'.repeat(1100)],
    ['不同原文', '完全无关'], ['', '识别内容'], ['😀A𠮷乙', '😀😀A𠮷甲乙'],
  ]
  let state = 74931
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32 }
  const alphabet = Array.from('甲乙丙丁aA12，。😀')
  for (let n = 0; n < 160; n++) {
    const original = Array.from({ length: 8 + Math.floor(random() * 48) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
    const recognized = Array.from(original).flatMap(char => random() < .15 ? [] : random() < .25 ? [alphabet[Math.floor(random() * alphabet.length)], char] : [char]).join('')
    pairs.push([original, recognized])
  }
  for (const [original, recognized] of pairs) {
    const a = Array.from(original), b = Array.from(recognized)
    const result = await alignSpeechTimings(original, timings(recognized))
    expect(result.map(char => char.text).join('')).toBe(original)
    const matched = result.filter(char => !char.estimated)
    expect(matched.length, `${original} / ${recognized}`).toBe(lcsLength(a, b))
    const indices = matched.map(char => char.startMs / 100)
    expect(indices.every((index, i) => Number.isInteger(index) && b[index] === matched[i].text && (i === 0 || index > indices[i - 1]))).toBe(true)
    expect(result.filter(char => char.estimated).every(char => char.confidence === 0 && !char.startExact && !char.endExact)).toBe(true)
  }
})

it('keeps repeated phrases at their contextual occurrences and exposes extra recognition at both ends', async () => {
  const original = '打开后台甲打开后台乙'
  const recognized = '旁白打开后台甲重说打开后台乙结束'
  const result = await alignSpeechTimings(original, timings(recognized))
  expect(result.filter(char => !char.estimated).map(char => char.startMs / 100)).toEqual([2, 3, 4, 5, 6, 9, 10, 11, 12, 13])
  expect([result[0], result[4], result[5], result.at(-1)!].every(char => char.mismatch)).toBe(true)
})

it('retains original word identities and exact endpoints while within-word timestamps remain estimates', async () => {
  const result = await alignSpeechTimings('甲乙新增丙丁', { granularity: 'word', items: [
    { text: '额外', startMs: 0, endMs: 100 },
    { text: '甲乙', startMs: 100, endMs: 500, confidence: .9 },
    { text: '丙丁', startMs: 800, endMs: 1200, confidence: .8 },
  ] })
  expect(result).toMatchObject([
    { wordId: 1, startMs: 100, endMs: 300, startExact: true, endExact: false, estimated: true, confidence: .9, mismatch: true },
    { wordId: 1, startMs: 300, endMs: 500, startExact: false, endExact: true, estimated: true },
    { startMs: 500, endMs: 650, estimated: true, confidence: 0, mismatch: true },
    { startMs: 650, endMs: 800, estimated: true, confidence: 0, mismatch: true },
    { wordId: 2, wordStartMs: 800, wordEndMs: 1200, estimated: true, startExact: true },
    { wordId: 2, estimated: true, endExact: true },
  ])
  expect(result.slice(2, 4).every(char => char.wordId === undefined)).toBe(true)
})

it('does not turn recognition insertions or spelling/number substitutions into precise edit times', async () => {
  const inserted = await alignSpeechTimings('甲新增乙', timings('甲额外补充乙'))
  expect(inserted.slice(1, 3)).toMatchObject([{ startMs: 100, endMs: 100, confidence: 0, mismatch: true }, { startMs: 100, endMs: 100, confidence: 0, mismatch: true }])
  const replaced = await alignSpeechTimings('甲X乙', timings('甲Y乙'))
  expect(replaced[1]).toMatchObject({ startMs: 100, endMs: 200, estimated: true, confidence: 0, mismatch: true })
  expect(replaced[1]).not.toHaveProperty('wordId')
  const mixed = await alignSpeechTimings('Henji AI ２', timings('Henji AL 2'))
  expect(mixed.filter(char => char.text === 'I' || char.text === '２').every(char => char.estimated && char.confidence === 0)).toBe(true)
  const sentence = await alignSpeechTimings('甲乙', { granularity: 'sentence', items: [{ text: '甲乙', startMs: 0, endMs: 500 }] })
  expect(sentence.every(char => char.estimated && !char.startExact && !char.endExact && char.wordId === undefined)).toBe(true)
})

it('handles a long unrelated script without dropping the original or fabricating word anchors', async () => {
  const original = '甲乙丙丁'.repeat(2500)
  const result = await alignSpeechTimings(original, timings('子丑寅卯'.repeat(2500)))
  expect(result.map(char => char.text).join('')).toBe(original)
  expect(result.every(char => char.estimated && char.confidence === 0 && char.mismatch && !char.startExact && !char.endExact && char.wordId === undefined)).toBe(true)
})
