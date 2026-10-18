import { expect, it } from 'vitest'
import { adaptiveSubtitlePause, normalizeSubtitlePunctuation, resolveSubtitleStyle, subtitleWidth } from './subtitleStyleProfiles'
import { segmentTimedSubtitles, wrapStyledSubtitle, type SubtitleToken } from './subtitleSegmentation'
import { buildSpeechSubtitles } from './speechSubtitles'
import { alignSpeechTimings } from '../media/alignSpeechTimings'
import type { SpeechTimings } from '../media/speechTimings'

it('统一标点、半字计数与可覆盖规范，顿号不能留在行尾', () => {
  expect(normalizeSubtitlePunctuation('甲，乙。丙；丁：戊——己、', 'netflix_zh_hans')).toBe('甲 乙 丙 丁 戊 己')
  expect(normalizeSubtitlePunctuation('真的？！…', 'netflix_zh_hans')).toBe('真的？！…')
  expect(subtitleWidth('AI 12')).toBe(2.5)
  expect(wrapStyledSubtitle('你好、欢迎大家来剪辑字幕', { maxCharacters: 5 })).not.toMatch(/、(?:\n|$)/)
  expect(resolveSubtitleStyle({ maxCharacters: 18 }).maxCharacters).toBe(18)
  expect(() => resolveSubtitleStyle({ minDurationSeconds: 8 })).toThrow('minDurationSeconds')
})

it('中英混排换行将连续拉丁词组视为整体', () => {
  expect(wrapStyledSubtitle('最后一句提到 Large Language Model')).toBe('最后一句提到\nLarge Language Model')
})

it('同句无法补足最短时长时才跨句合并短尾句', () => {
  const cues = segmentTimedSubtitles([
    { text: '也就是大语言模型。', startMs: 0, endMs: 1800 },
    { text: '好的。', startMs: 1950, endMs: 2333 },
  ], { startMs: 0, endMs: 2333 })
  expect(cues).toHaveLength(1)
  expect(cues[0]).toMatchObject({ text: '也就是大语言模型 好的', startMs: 0, endMs: 2333 })
})

it('短意群在同句内合并、利用空隙满足阅读速度，并将小于500ms间隙接续', () => {
  const tokens: SubtitleToken[] = [
    { text: '它们更像一个剧组，', startMs: 0, endMs: 1600 },
    { text: '各管一摊。', startMs: 1800, endMs: 2150 },
    { text: '图片模型，只会画；', startMs: 2700, endMs: 4200 },
    { text: '音频模型，只会出声。', startMs: 4400, endMs: 5900 },
  ]
  const cues = segmentTimedSubtitles(tokens, { startMs: 0, endMs: 7500 })
  expect(cues[0].text.replace(/\n/g, '')).toBe('它们更像一个剧组 各管一摊')
  expect(cues.every(cue => cue.endMs - cue.startMs >= 1000 * 5 / 6)).toBe(true)
  expect(cues.every(cue => subtitleWidth(cue.text) / ((cue.endMs - cue.startMs) / 1000) <= 9)).toBe(true)
  expect(cues.find(cue => cue.text.includes('图片模型'))?.text).not.toContain('音频模型')
  expect(cues[1].endMs).toBe(cues[2].startMs)
  expect(adaptiveSubtitlePause([120, 160, 200, 280, 410])).toBe(350)
  const reading = segmentTimedSubtitles([{ text: '一二三四五六七八九', startMs: 0, endMs: 400 }], { startMs: 0, endMs: 2000 })
  expect(reading[0].endMs).toBe(1000)
})

const narration = '聊天的叫AI，画画的叫AI，配音、做视频的，也叫AI。它们是同一个东西吗？\n不是。它们更像一个剧组，各管一摊。\n大语言模型，懂文字、会思考；图片模型，只会画；音频模型，只会出声；视频模型，负责让画面动起来。\n但它们能接力：你说一句话，大语言模型先听懂、拆好任务、写出指令，再交给画图的、配音的、做视频的去干活。\n所以，AI看着五花八门，真正把这一切串起来的，是那个听得懂人话的——大语言模型。\n顺便说一句，这条视频，就是它们一起做出来的。'
const reference = '聊天的叫AI 画画的叫AI｜配音、做视频的 也叫AI｜它们是同一个东西吗？｜不是 它们更像一个剧组 各管一摊｜大语言模型 懂文字、会思考｜图片模型 只会画｜音频模型 只会出声｜视频模型 负责让画面动起来｜但它们能接力 你说一句话｜大语言模型先听懂｜拆好任务、写出指令｜再交给画图的｜配音的、做视频的去干活｜所以 AI看着五花八门｜真正把这一切串起来的｜是那个听得懂人话的 大语言模型｜顺便说一句｜这条视频就是它们一起做出来的'.split('｜')

function fixture(): SpeechTimings {
  const parts = Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(narration), part => part.segment)
  const items: SpeechTimings['items'] = []
  let clock = 0; let prefix = ''
  for (const text of parts) {
    prefix += text
    if (!/[\p{L}\p{N}]/u.test(text)) {
      if (items.length && /\p{P}/u.test(text)) items.at(-1)!.text += text
      if (/[，；：。？！]/u.test(text)) clock = items.at(-1)!.endMs + (/一句，$/u.test(prefix) ? 360 : /写出指令，$/u.test(prefix) ? 410 : 300)
      if (/这条视频，$/u.test(prefix)) clock = items.at(-1)!.endMs
      continue
    }
    const duration = text === '不是' ? 900 : Math.max(240, subtitleWidth(text) / 7 * 1000)
    items.push({ text, startMs: clock, endMs: clock + duration }); clock += duration
    // Actual short intra-phrase pauses, and zero-gap 视频/就是 liaison.
    if (!/这条视频$/u.test(prefix)) clock += [120, 160, 200][items.length % 3]
  }
  return { granularity: 'word', items }
}

it('18段参考：强气口后断开，零间隔连读不拆，字幕不在词念完前切换', async () => {
  const timings = fixture(); const fps = 60
  const duration = Math.ceil((timings.items.at(-1)!.endMs + 1500) / 1000 * fps)
  const result = await buildSpeechSubtitles(narration, timings, { id: 'voice', start: 0, duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, { numerator: fps, denominator: 1 })
  const texts = result.map(cue => cue.caption.text.replace(/\n/g, ''))
  expect(reference).toHaveLength(18)
  expect(texts.join('')).not.toMatch(/[，。,.;；:：—]/u)
  expect(texts.some(text => text.includes('写出指令') && text.includes('再交给'))).toBe(false)
  expect(texts.some(text => text.includes('这条视频') && text.includes('就是'))).toBe(true)
  expect(texts.some(text => text.includes('顺便说一句') && text.includes('这条视频'))).toBe(false)
  expect(texts.some(text => text.includes('图片模型') && text.includes('音频模型'))).toBe(false)
  expect(texts, texts.join('｜')).not.toContain('各管一摊')
  expect(result.every((cue, index) => !result[index + 1] || cue.caption.start + cue.caption.duration === result[index + 1].caption.start)).toBe(true)
  for (const cue of result) {
    expect(cue.caption.duration).toBeGreaterThanOrEqual(50)
    expect(cue.caption.duration).toBeLessThanOrEqual(420)
    expect(cue.caption.text.split('\n').length).toBeLessThanOrEqual(2)
    expect(cue.caption.text.split('\n').every(line => subtitleWidth(line) <= 16)).toBe(true)
    const first = timings.items.find(item => Math.abs(Math.round(item.startMs * fps / 1000) - cue.caption.start) <= 1)
    expect(first).toBeDefined()
    const last = timings.items.filter(item => item.startMs >= first!.startMs && Math.floor(item.startMs * fps / 1000 + 1e-7) < cue.caption.start + cue.caption.duration).at(-1)!
    // Both edges floor to the sequence grid, so an end may precede speech by less than one frame.
    expect(cue.caption.start + cue.caption.duration).toBeGreaterThanOrEqual(Math.floor(last.endMs * fps / 1000 + 1e-7))
  }
})

it('识别插入的LLM时间不分摊给原文缺字；原文保持权威', async () => {
  const result = await alignSpeechTimings('大语言模型先听懂', { granularity: 'word', items: [
    { text: '大语言模型', startMs: 0, endMs: 1000 }, { text: '（LLM）', startMs: 1000, endMs: 1800 }, { text: '听懂', startMs: 1800, endMs: 2200 },
  ] })
  const missing = result.find(char => char.text === '先')!
  expect(missing.endMs).toBe(missing.startMs)
  expect(result.map(char => char.text).join('')).toBe('大语言模型先听懂')
})

it('能量停顿修正估算词边界；已识别的词时钟不被能量覆盖', () => {
  const tokens: SubtitleToken[] = [
    { text: '我们已经写出指令，', startMs: 0, endMs: 3000, timing: 'estimated' },
    { text: '再交给画图的工作伙伴。', startMs: 3000, endMs: 6000, timing: 'estimated' },
  ]
  const pauses = [{ startMs: 2800, endMs: 3200 }]
  const result = segmentTimedSubtitles(tokens, { startMs: 0, endMs: 7000 }, {}, pauses)
  expect(result).toHaveLength(2)
  expect(result[1].startMs).toBe(3200)
  expect(result[0].endMs).toBe(3200)
  const exact = segmentTimedSubtitles(tokens.map(token => ({ ...token, timing: 'word' })), { startMs: 0, endMs: 7000 }, {}, pauses)
  expect(exact.every(cue => cue.startMs === 0 || cue.startMs === 3000)).toBe(true)
})

it('明确声音证据可解释连续ASR词之间的气口，但不篡改已识别词时间', () => {
  const tokens: SubtitleToken[] = [{ text: '我们已经写出指令，', startMs: 0, endMs: 3000, timing: 'word' }, { text: '再交给画图的工作伙伴。', startMs: 3000, endMs: 6000, timing: 'word' }]
  const snapshot = structuredClone(tokens)
  const result = segmentTimedSubtitles(tokens, { startMs: 0, endMs: 7000 }, {}, [{ startMs: 2800, endMs: 3200, evidence: 'audio' }])
  expect(result).toHaveLength(2)
  expect(result[1].startMs).toBe(3000)
  expect(tokens).toEqual(snapshot)
})

it('变速后的最短时长使用序列时间，局部原文只对齐片段源范围内的同名词', async () => {
  const timings: SpeechTimings = { granularity: 'word', items: [
    { text: '你好。', startMs: 0, endMs: 400 }, { text: '你好。', startMs: 2000, endMs: 2400 },
  ] }
  const result = await buildSpeechSubtitles('你好。', timings, { id: 'voice', start: 120, duration: 120, sourceInUs: 2000000, sourceRemainder: { numerator: 0, denominator: 1 }, speed: { numerator: 2, denominator: 1 } }, { numerator: 60, denominator: 1 }, {}, undefined, [], 'clip')
  expect(result).toHaveLength(1)
  expect(result[0].caption).toMatchObject({ text: '你好', start: 120, duration: 50 })
})
