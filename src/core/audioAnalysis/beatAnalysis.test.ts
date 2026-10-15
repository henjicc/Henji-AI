import { expect, it } from 'vitest'
import { BeatAnalyzer } from './beatAnalysis'

function fixture(bpm: number, sampleRate: number, count = 20): { pcm: Float32Array; expected: number[] } {
  const expected = Array.from({ length: count }, (_, i) => .137 + i * 60 / bpm)
  const pcm = new Float32Array(Math.ceil((expected.at(-1)! + .2) * sampleRate))
  expected.forEach((seconds, beat) => {
    const start = Math.round(seconds * sampleRate)
    for (let i = 0; i < sampleRate * .035; i++) pcm[start + i] += (beat % 4 === 0 ? 1 : .65) * Math.exp(-i / (sampleRate * .008)) * Math.cos(2 * Math.PI * 90 * i / sampleRate)
  })
  return { pcm, expected }
}
it.each([60, 90, 120, 137, 180])('合成 %s BPM 节拍召回 100%%，误差 ≤ 30fps 一帧，保留重音强度', bpm => {
  const { pcm, expected } = fixture(bpm, 48000), analyzer = new BeatAnalyzer(48000)
  for (let at = 0; at < pcm.length; at += 47999) analyzer.append([pcm.subarray(at, at + 47999)])
  const result = analyzer.finish()
  const errors = expected.map(time => Math.min(...result.beats.map(beat => Math.abs(beat.seconds - time))))
  expect(errors.filter(error => error <= 1 / 30).length / expected.length).toBe(1)
  expect(Math.max(...errors)).toBeLessThanOrEqual(1 / 30)
  expect(result.beats).toHaveLength(expected.length)
  expect(result.tempo).toBeCloseTo(bpm, 0)
  expect(result.beats[0].strength).toBeGreaterThan(result.beats[1].strength)
})
it.each([44100, 48000])('跨块、首尾、反相立体声与一次输入保持一致（%sHz）', rate => {
  const { pcm } = fixture(120, rate), whole = new BeatAnalyzer(rate), chunked = new BeatAnalyzer(rate)
  whole.append([pcm])
  const opposite = Float32Array.from(pcm, value => -value)
  for (let at = 0; at < pcm.length; at += 1009) chunked.append([pcm.subarray(at, at + 1009), opposite.subarray(at, at + 1009)])
  expect(chunked.finish()).toEqual(whole.finish())
})
it('静音和不足三个攻击只产生空节拍；拒绝非法 PCM 与采样率', () => {
  const silence = new BeatAnalyzer(48000); silence.append([new Float32Array(48000)]); expect(silence.finish()).toEqual({ beats: [], onsets: [], tempo: null })
  const short = new BeatAnalyzer(48000); short.append([fixture(120, 48000, 2).pcm]); expect(short.finish().beats).toEqual([])
  expect(() => new BeatAnalyzer(0)).toThrow(); expect(() => new BeatAnalyzer(48000).append([Float32Array.of(NaN)])).toThrow()
  expect(() => new BeatAnalyzer(48000).append([new Float32Array(2), new Float32Array(1)])).toThrow()
})

it.each([44100, 48000])('混合持续音与弱八分音符时，任意分块、重复分析、反相双声道仍完全一致（%sHz）', rate => {
  const { pcm, expected } = fixture(137, rate, 24)
  for (let i = 0; i < pcm.length; i++) pcm[i] += .03 * Math.sin(2 * Math.PI * 220 * i / rate)
  for (const time of expected) {
    const from = Math.round((time + 30 / 137) * rate)
    for (let i = 0; i < rate * .025 && from + i < pcm.length; i++) pcm[from + i] += .1 * Math.exp(-i / (rate * .005)) * Math.cos(2 * Math.PI * 3000 * i / rate)
  }
  const whole = new BeatAnalyzer(rate), repeated = new BeatAnalyzer(rate), chunked = new BeatAnalyzer(rate)
  whole.append([pcm]); repeated.append([pcm])
  const opposite = Float32Array.from(pcm, value => -value)
  const sizes = [1, 137, 4093, 65536]
  for (let at = 0, block = 0; at < pcm.length; block++) {
    const end = at + sizes[block % sizes.length]
    chunked.append([pcm.subarray(at, end), opposite.subarray(at, end)]); at = end
  }
  const result = whole.finish()
  expect(chunked.finish()).toEqual(result); expect(repeated.finish()).toEqual(result)
  expect(result.tempo).toBeCloseTo(137, 0)
  expect(result.beats).toHaveLength(expected.length)
  for (const time of expected) expect(result.beats.some(beat => Math.abs(beat.seconds - time) < 1 / 30)).toBe(true)
})

it('跨静音后重新跟随起音相位，不在间歇中填入虚构节拍', () => {
  const rate = 48000, first = fixture(120, rate, 16), second = fixture(120, rate, 16)
  const offset = 10.123, pcm = new Float32Array(Math.ceil(offset * rate) + second.pcm.length)
  pcm.set(first.pcm); pcm.set(second.pcm, Math.ceil(offset * rate))
  const analyzer = new BeatAnalyzer(rate); analyzer.append([pcm])
  const result = analyzer.finish(), expected = [...first.expected, ...second.expected.map(time => time + offset)]
  expect(result.beats).toHaveLength(expected.length)
  for (const time of expected) expect(result.beats.some(beat => Math.abs(beat.seconds - time) < 1 / 30)).toBe(true)
  expect(result.beats.some(beat => beat.seconds > first.pcm.length / rate && beat.seconds < offset)).toBe(false)
})
