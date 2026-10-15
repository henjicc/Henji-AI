import { expect, it } from 'vitest'
import { AudioContentAnalyzer, sampleAudioContent } from './contentAnalysis'

it.each([60, 90, 120, 137, 180])('%s BPM 的起音、节拍误差不超过一帧，分块一致', bpm => {
  const rate = 48000, fps = 60, times = Array.from({ length: 20 }, (_, i) => .137 + i * 60 / bpm)
  const pcm = new Float32Array(Math.ceil((times.at(-1)! + .2) * rate))
  for (const time of times) for (let i = 0; i < rate * .035; i++) pcm[Math.round(time * rate) + i] = Math.exp(-i / (rate * .008)) * Math.cos(2 * Math.PI * 90 * i / rate)
  const a = new AudioContentAnalyzer(rate, fps), b = new AudioContentAnalyzer(rate, fps)
  a.append([pcm])
  for (let i = 0; i < pcm.length; i += 701) b.append([pcm.slice(i, i + 701)])
  const result = a.finish(); expect(b.finish()).toEqual(result)
  expect(result.bpm).toBeCloseTo(bpm, 0)
  for (const time of times) {
    expect(Math.min(...result.beats.map(value => Math.abs(value - time)))).toBeLessThanOrEqual(1 / fps)
    expect(Math.min(...result.onsets.map(value => Math.abs(value - time)))).toBeLessThanOrEqual(1 / fps)
  }
  const first = sampleAudioContent(result, 'level', 2)
  sampleAudioContent(result, 'level', .1)
  expect(sampleAudioContent(result, 'level', 2)).toEqual(first)
})
it.each([[100, 'bass'], [1000, 'mid'], [8000, 'treble']] as const)('RMS 与 %sHz 频段保留反相立体声能量', (frequency, band) => {
  const pcm = Float32Array.from({ length: 48000 }, (_, i) => .5 * Math.sin(2 * Math.PI * frequency * i / 48000))
  const analyzer = new AudioContentAnalyzer(48000, 30)
  analyzer.append([pcm, Float32Array.from(pcm, value => -value)])
  const result = analyzer.finish()
  expect(result.levels[15]).toBeCloseTo(Math.sqrt(.125), 2)
  expect(result.bands[band][15]).toBeGreaterThan(.3)
  for (const other of ['bass', 'mid', 'treble'] as const) if (other !== band) expect(result.bands[other][15]).toBeLessThan(.07)
})
it('静音、越界和无音频返回零；无音频节拍为空；非法输入失败', () => {
  const analyzer = new AudioContentAnalyzer(48000, 30); analyzer.append([new Float32Array(48000)])
  const result = analyzer.finish()
  expect(result.levels).toHaveLength(30); expect(result.levels.every(value => value === 0)).toBe(true)
  expect(result.beats).toEqual([]); expect(result.bpm).toBe(0)
  expect(sampleAudioContent(undefined, 'level', 0)).toBe(0)
  expect(sampleAudioContent(undefined, 'beats', 0)).toEqual([])
  expect(sampleAudioContent(result, 'level', -1)).toBe(0)
  expect(() => new AudioContentAnalyzer(48000, 0)).toThrow('帧率')
  expect(() => new AudioContentAnalyzer(48000, 30).append([Float32Array.of(NaN)])).toThrow('无效采样')
})
