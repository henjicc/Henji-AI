import { expect, it } from 'vitest'
import { AudioContentAnalyzer } from './contentAnalysis'

/**
 * 比单纯点击音更接近真实音乐的合成混音：无鼓前奏、摇摆八分踩镲、贝斯、和弦铺底、中段只剩贝斯与铺底的间歇。
 * 节拍真值已知，用来量 BPM 是否落在正确的倍频以及鼓段内的节拍命中率。
 */
function mix(bpm: number, seed: number, swingRatio: number): { pcm: Float32Array; beats: number[]; rate: number } {
  const rate = 48000, beat = 60 / bpm, bars = 16, intro = 2, breakFrom = 9, breakTo = 11
  const pcm = new Float32Array(Math.ceil((bars * 4 * beat + 1) * rate))
  let state = seed
  const random = (): number => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
  const add = (start: number, length: number, sample: (t: number, i: number) => number): void => {
    const from = Math.round(start * rate)
    for (let i = 0; i < length * rate && from + i < pcm.length; i++) pcm[from + i] += sample(i / rate, i)
  }
  const roots = [55, 65.41, 49, 58.27]
  for (let bar = 0; bar < bars; bar++) {
    const root = roots[bar % 4]; const barStart = bar * 4 * beat
    // 和弦铺底：慢起音，全程都在，给检测器制造持续能量。
    add(barStart, 4 * beat, t => .05 * Math.min(1, t / .4) * [1, 1.26, 1.5].reduce((sum, ratio) => sum + Math.sin(2 * Math.PI * root * 4 * ratio * t), 0))
    const drums = bar >= intro && (bar < breakFrom || bar >= breakTo)
    for (let step = 0; step < 8; step++) {
      const swing = step % 2 ? beat * swingRatio : 0
      const at = barStart + Math.floor(step / 2) * beat + swing + (random() - .5) * .006
      // 贝斯跟八分音符走，力度起伏，间歇段也在。
      if (bar >= intro) add(at, beat * .45, t => (.18 + .08 * random()) * Math.exp(-t * 7) * Math.sin(2 * Math.PI * root * t))
      if (!drums) continue
      add(at, .05, () => (.05 + .04 * (step % 2 ? 1 : 0)) * (random() * 2 - 1) * (step % 2 ? 1 : .6))
      if (step % 2) continue
      const quarter = step / 2
      if (quarter % 2 === 0) add(at, .25, t => .7 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (110 * Math.exp(-t * 30) + 45) * t))
      else add(at, .18, t => Math.exp(-t * 22) * (.35 * (random() * 2 - 1) + .2 * Math.sin(2 * Math.PI * 190 * t)))
    }
  }
  const beats: number[] = []
  for (let bar = intro; bar < bars; bar++) if (bar < breakFrom || bar >= breakTo) for (let quarter = 0; quarter < 4; quarter++) beats.push(bar * 4 * beat + quarter * beat)
  return { pcm, beats, rate }
}

it.each([[86, 3, .5], [104, 7, .5], [128, 11, .5], [142, 19, .5], [86, 5, .58], [104, 7, .58], [128, 11, .58], [142, 19, .62]])('合成混音 %s BPM（种子 %s，后八分位置 %s）：速度在正确倍频，鼓段节拍命中率不低于 90%%（±1 帧）', (bpm, seed, swingRatio) => {
  const fps = 30; const { pcm, beats, rate } = mix(bpm, seed, swingRatio)
  const analyzer = new AudioContentAnalyzer(rate, fps); analyzer.append([pcm])
  const result = analyzer.finish()
  expect(Math.abs(result.bpm - bpm)).toBeLessThanOrEqual(1.5)
  const hits = beats.filter(time => result.beats.some(value => Math.abs(value - time) <= 1 / fps)).length
  expect(hits / beats.length).toBeGreaterThanOrEqual(.9)
})
