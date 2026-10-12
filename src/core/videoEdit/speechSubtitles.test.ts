import { expect, it } from 'vitest'
import { buildSpeechSubtitles } from './speechSubtitles'
import type { SpeechTimings } from '../media/speechTimings'
import { splitSubtitleText } from './autoSubtitles'

export const narration = '聊天的叫AI，画画的叫AI，配音、做视频的，也叫AI。它们是同一个东西吗？\n不是。它们更像一个剧组，各管一摊。\n大语言模型，懂文字、会思考；图片模型，只会画；音频模型，只会出声；视频模型，负责让画面动起来。\n但它们能接力：你说一句话，大语言模型先听懂、拆好任务、写出指令，再交给画图的、配音的、做视频的去干活。\n所以，AI看着五花八门，真正把这一切串起来的，是那个听得懂人话的——大语言模型。\n顺便说一句，这条视频，就是它们一起做出来的。'
const rate = { numerator: 30, denominator: 1 }
const clip = { id: 'voice', start: 90, duration: 3000, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
function timings(text: string): SpeechTimings { return { granularity: 'char', items: Array.from(text).map((text, index) => ({ text, startMs: index * 100, endMs: (index + 1) * 100 })) } }
it('native narration fixture retains every original character without recognition', async () => {
  const result = await buildSpeechSubtitles(narration, timings(narration), clip, rate)
  expect(result.map(value => value.caption.text.replace(/\n/g, '')).join('')).toBe(narration.replace(/\n/g, ''))
  expect(result[0]).toMatchObject({ startUs: 3000000, confidence: 1, estimated: false })
})
it('source newlines force cues, layout alone inserts line breaks, and narration has no broken short tails', async () => {
  const result = await buildSpeechSubtitles(narration, timings(narration.replace(/\n/g, '')), clip, rate, { maxCharacters: 18, maxLines: 1 })
  const texts = result.map(value => value.caption.text)
  expect(texts.join('')).toBe(narration.replace(/\n/g, ''))
  expect(texts.every(text => text === text.trim() && !/[\r\n]/.test(text))).toBe(true)
  expect(texts).not.toEqual(expect.arrayContaining(['来。', '出来的。']))
  expect(texts.some(text => text.includes('人话'))).toBe(true)
  expect(texts.every(text => Array.from(text).length <= 20)).toBe(true)
  const multiline = await buildSpeechSubtitles('  第一段\r\n\n 第二段内容很长要排版  ', timings('第一段第二段内容很长要排版'), clip, rate, { maxCharacters: 5, maxLines: 2 })
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
  expect(splitSubtitleText('甲乙丙丁戊己。', 4, 1)).toEqual(['甲乙丙', '丁戊己。'])
  expect(splitSubtitleText('Hello extraordinary world.', 8, 1)).toEqual(['Hello', 'extraordinary', 'world.'])
})
it('uses nonuniform Chinese word timestamps as character anchors rather than distributing the sentence', async () => {
  const result = await buildSpeechSubtitles('你好\n世界！', { granularity: 'word', items: [
    { text: '你好', startMs: 100, endMs: 300 }, { text: '世界！', startMs: 1000, endMs: 1900 },
  ] }, { ...clip, start: 0 }, rate, { maxLines: 1 })
  expect(result.map(value => [value.caption.text, value.caption.start, value.caption.duration, value.estimated])).toEqual([
    ['你好', 3, 6, true], ['世界！', 30, 27, true],
  ])
})
it.each([false, true])('maps offset, trim and speed, reverse=%s', async reverse => {
  const result = await buildSpeechSubtitles('甲乙丙丁戊己', timings('甲乙丙丁戊己'), { ...clip, duration: 6, sourceInUs: reverse ? 600000 : 200000, speed: { numerator: 2, denominator: 1 }, reverse }, rate)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ caption: { text: '丙丁戊己', start: 90, duration: 6 }, startUs: 3000000, endUs: 3200000 })
})
