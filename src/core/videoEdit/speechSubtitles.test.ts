import { expect, it } from 'vitest'
import { buildSpeechSubtitles } from './speechSubtitles'
import type { SpeechTimings } from '../media/speechTimings'

export const narration = '聊天的叫AI，画画的叫AI，配音、做视频的，也叫AI。它们是同一个东西吗？不是。它们更像一个剧组，各管一摊。大语言模型，懂文字、会思考；图片模型，只会画；音频模型，只会出声；视频模型，负责让画面动起来。但它们能接力：你说一句话，大语言模型先听懂、拆好任务、写出指令，再交给画图的、配音的、做视频的去干活。所以，AI看着五花八门，真正把这一切串起来的，是那个听得懂人话的——大语言模型。顺便说一句，这条视频，就是它们一起做出来的。'
const rate = { numerator: 30, denominator: 1 }
const clip = { id: 'voice', start: 90, duration: 3000, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
function timings(text: string): SpeechTimings { return { granularity: 'char', items: Array.from(text).map((text, index) => ({ text, startMs: index * 100, endMs: (index + 1) * 100 })) } }
it('native narration fixture retains every original character without recognition', async () => {
  const result = await buildSpeechSubtitles(narration, timings(narration), clip, rate)
  expect(result.map(value => value.caption.text).join('')).toBe(narration)
  expect(result[0]).toMatchObject({ startUs: 3000000, confidence: 1, estimated: false })
})
it.each([false, true])('maps offset, trim and speed, reverse=%s', async reverse => {
  const result = await buildSpeechSubtitles('甲乙丙丁戊己', timings('甲乙丙丁戊己'), { ...clip, duration: 6, sourceInUs: reverse ? 600000 : 200000, speed: { numerator: 2, denominator: 1 }, reverse }, rate)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ caption: { text: '丙丁戊己', start: 90, duration: 6 }, startUs: 3000000, endUs: 3200000 })
})
