import { expect, it } from 'vitest'
import { buildSpeechSubtitles } from './speechSubtitles'
import type { SpeechTimings } from '../media/speechTimings'
import { splitSubtitleText } from './autoSubtitles'

export const narration = '聊天的叫AI，画画的叫AI，配音、做视频的，也叫AI。它们是同一个东西吗？\n不是。它们更像一个剧组，各管一摊。\n大语言模型，懂文字、会思考；图片模型，只会画；音频模型，只会出声；视频模型，负责让画面动起来。\n但它们能接力：你说一句话，大语言模型先听懂、拆好任务、写出指令，再交给画图的、配音的、做视频的去干活。\n所以，AI看着五花八门，真正把这一切串起来的，是那个听得懂人话的——大语言模型。\n顺便说一句，这条视频，就是它们一起做出来的。'
const rate = { numerator: 30, denominator: 1 }
const clip = { id: 'voice', start: 90, duration: 3000, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }

it('ASR 多出句末标点仍采用词边界与对齐置信度，原文标点不降级精度', async () => {
  const result = await buildSpeechSubtitles('它会写代码、画图。', { granularity: 'word', items: [
    { text: '它', startMs: 300, endMs: 500, confidence: .98 },
    { text: '会', startMs: 500, endMs: 800, confidence: .97 },
    { text: '写代码，', startMs: 800, endMs: 1800, confidence: .9 },
    { text: '画图！', startMs: 1800, endMs: 2800, confidence: .86 },
  ] }, { ...clip, start: 0, duration: 84 }, rate)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ caption: { start: 9, duration: 75 }, estimated: false, confidence: .86 })
})

it('两行容得下的同一列举意群不在顿号处另起字幕', async () => {
  const original = '它不只是会聊天，还能帮你写代码、画图、做视频……'
  const parts = ['它', '不', '只是', '会', '聊天，', '还', '能', '帮', '你', '写', '代码、', '画图、', '做', '视频……']
  const result = await buildSpeechSubtitles(original, { granularity: 'word', items: parts.map((text, index) => ({ text, startMs: index * 300, endMs: index * 300 + 200 })) }, { ...clip, start: 0, duration: 126 }, rate)
  expect(result.map(value => value.caption.text)).toEqual(['它不只是会聊天\n还能帮你写代码、画图、做视频……'])
})

it('识别在原文词内拆词或多出标点时不插空格、不拆符号一词', async () => {
  const original = '第二行故意写得很长很长没有任何标点符号看看它到底会在哪里断开。'
  const parts = ['第二行', '故意', '写得', '很长', '很长', '没有', '任何', '标点符', '号，', '看看', '它', '到底', '会', '在', '哪里', '断开。']
  const result = await buildSpeechSubtitles(original, { granularity: 'word', items: parts.map((text, index) => ({ text, startMs: index * 700, endMs: index * 700 + 450 })) }, clip, rate)
  const texts = result.map(value => value.caption.text)
  expect(texts.join('').replace(/\n/g, '')).toBe(original.slice(0, -1))
  expect(texts.join('')).not.toMatch(/符\s+号/u)
  expect(texts.some(text => text.includes('符号'))).toBe(true)
  expect(texts.every(text => !text.endsWith('符') && !text.startsWith('号'))).toBe(true)
})
const spoken = (text: string) => text.replace(/[\s\p{P}]/gu, '')
function timings(text: string): SpeechTimings { return { granularity: 'char', items: Array.from(text).map((text, index) => ({ text, startMs: index * 100, endMs: (index + 1) * 100 })) } }
it('native narration fixture retains every original character without recognition', async () => {
  const result = await buildSpeechSubtitles(narration, timings(narration), clip, rate)
  expect(spoken(result.map(value => value.caption.text).join(''))).toBe(spoken(narration))
  expect(result[0]).toMatchObject({ startUs: 3000000, confidence: 1, estimated: false })
})
it('source newlines force cues, layout alone inserts line breaks, and narration has no broken short tails', async () => {
  const result = await buildSpeechSubtitles(narration, timings(narration.replace(/\n/g, '')), clip, rate, { maxCharacters: 18, maxLines: 1, minDurationSeconds: 0 })
  const texts = result.map(value => value.caption.text)
  expect(spoken(texts.join(''))).toBe(spoken(narration))
  expect(texts.every(text => text === text.trim() && !/[\r\n]/.test(text))).toBe(true)
  expect(texts).not.toEqual(expect.arrayContaining(['来。', '出来的。']))
  expect(texts.some(text => text.includes('人话'))).toBe(true)
  expect(texts.every(text => Array.from(text).reduce((n, c) => n + (/[A-Za-z0-9]/.test(c) ? .5 : 1), 0) <= 20)).toBe(true)
  const multiline = await buildSpeechSubtitles('  第一段\r\n\n 第二段内容很长要排版  ', timings('第一段第二段内容很长要排版'), clip, rate, { maxCharacters: 5, maxLines: 2, minDurationSeconds: 0 })
  expect(multiline[0].caption.text).toBe('第一段')
  expect(multiline.slice(1).some(value => value.caption.text.includes('\n'))).toBe(true)
  expect(multiline.every(value => value.caption.text === value.caption.text.trim())).toBe(true)
})
it('chooses the nearest punctuation within the limit, merges short tails, and preserves English words', () => {
  expect(splitSubtitleText('甲乙，丙丁戊己庚辛壬癸', 8, 1)).toEqual(['甲乙，', '丙丁戊己庚辛壬癸'])
  for (const mark of ['，', '。', '；', '：', '、', '？', '！', '——', '…', ',', '.', ';', ':', '?', '!']) {
    expect(splitSubtitleText(`甲乙${mark}丙丁戊己庚辛壬癸`, 6, 1)[0]).toBe(`甲乙${mark}`)
  }
  expect(splitSubtitleText('甲乙丙丁戊己', 4, 1)).toEqual(['甲乙丙丁戊己'])
  expect(splitSubtitleText('甲乙丙丁戊己。', 4, 1)).toEqual(['甲乙丙丁', '戊己。'])
  expect(splitSubtitleText('Hello extraordinary world.', 8, 1)).toEqual(['Hello', 'extraordinary', 'world.'])
})
it('uses nonuniform Chinese word timestamps as character anchors rather than distributing the sentence', async () => {
  const result = await buildSpeechSubtitles('你好\n世界！', { granularity: 'word', items: [
    { text: '你好', startMs: 100, endMs: 300 }, { text: '世界！', startMs: 1000, endMs: 1900 },
  ] }, { ...clip, start: 0 }, rate, { maxLines: 1, minDurationSeconds: 0, maxReadingSpeed: 1000 })
  expect(result.map(value => [value.caption.text, value.caption.start, value.caption.duration, value.estimated])).toEqual([
    ['你好', 3, 6, false], ['世界！', 30, 27, false],
  ])
})
it.each([false, true])('maps offset, trim and speed, reverse=%s', async reverse => {
  const result = await buildSpeechSubtitles('甲乙丙丁戊己', timings('甲乙丙丁戊己'), { ...clip, duration: 6, sourceInUs: reverse ? 600000 : 200000, speed: { numerator: 2, denominator: 1 }, reverse }, rate)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ caption: { text: '丙丁戊己', start: 90, duration: 6 }, startUs: 3000000, endUs: 3200000 })
})

it('caption precision follows recognition boundaries and still reports insertion/deletion mismatches', async () => {
  const words: SpeechTimings = { granularity: 'word', items: [{ text: '中文词组', startMs: 0, endMs: 2000 }, { text: '准确边界', startMs: 2000, endMs: 4000 }] }
  const exact = await buildSpeechSubtitles('中文词组准确边界', words, { ...clip, start: 0 }, rate, { maxCharacters: 4, maxLines: 1, minDurationSeconds: 0 })
  expect(exact.map(cue => [cue.estimated, cue.confidence])).toEqual([[false, 1], [false, 1]])
  for (const text of ['中文新增词组准确边界', '中文组准确边界']) {
    const changed = await buildSpeechSubtitles(text, words, clip, rate, { minDurationSeconds: 0 })
    expect(changed.some(cue => cue.estimated && cue.confidence === 0)).toBe(true)
  }
  const inner = await buildSpeechSubtitles('中文词组准确边界', { granularity: 'word', items: [{ text: '中文词组准确边界', startMs: 0, endMs: 4000 }] }, clip, rate, { maxCharacters: 4, maxLines: 1, minDurationSeconds: 0 })
  expect(inner).toHaveLength(1)
  expect(inner[0]).toMatchObject({ estimated: false, confidence: 1, caption: { text: expect.any(String), duration: 120 } })
})
