import { describe, expect, it } from 'vitest'
import { detectAudioEditMouthClicks, scanAudioEditMouthClickCandidates, type AudioEditMouthClick } from './mouthClicks'

const RATE = 44100
const ms = (value: number, rate = RATE): number => Math.round(value * rate / 1000)

/** 可复现的伪随机（mulberry32） */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function resonate(x: Float64Array, freq: number, bandwidth: number, rate: number): void {
  const r = Math.exp(-Math.PI * bandwidth / rate)
  const c = 2 * r * Math.cos(2 * Math.PI * freq / rate)
  const g = 1 - c + r * r
  let y1 = 0, y2 = 0
  for (let n = 0; n < x.length; n++) { const y = g * x[n] + c * y1 - r * r * y2; y2 = y1; y1 = y; x[n] = y }
}

interface Speech { signal: Float32Array; syllables: number[]; envelope: Float32Array }

/**
 * 类元音口播：基频 100–250 Hz（音节内滑动、1% 抖动）的声门脉冲列经 4 个共振峰级联，
 * 高频另有 4–8 kHz 的并联共振峰（真实录音里浊音高频有逐周期的竖纹）加少量送气噪声，再乘音节包络、加轻微底噪。
 * 浊音帧残差尺度相对帧峰值约 −50 dB，与实测口播（约 −46 dB）相当。
 * fricatives：每隔一个音节在字头前放 30–120 ms 的宽频噪声段（s/sh 缓起，t/k 带 4 ms 爆破再接送气）。
 */
function synthSpeech(seconds: number, seed: number, options: { fricatives?: boolean; rate?: number } = {}): Speech {
  const rate = options.rate ?? RATE
  const rand = random(seed)
  const total = Math.round(seconds * rate)
  const out = new Float64Array(total)
  const syllables: number[] = []
  let t = ms(150, rate)
  while (t < total - ms(400, rate)) {
    const start = t
    const end = start + ms(150 + 200 * rand(), rate)
    syllables.push(start)
    const f0a = 100 + 150 * rand()
    const f0b = f0a * (0.8 + 0.4 * rand())
    const formants: Array<[number, number]> = [
      [300 + 500 * rand(), 60 + 60 * rand()], [900 + 1300 * rand(), 80 + 80 * rand()],
      [2400 + 600 * rand(), 120 + 100 * rand()], [3300 + 500 * rand(), 150 + 150 * rand()],
    ]
    const level = 0.25 + 0.5 * rand()
    const length = end - start + ms(80, rate)
    const source = new Float64Array(length)
    const excitation = new Float64Array(length)
    let phase = 0, g1 = 0, g2 = 0
    for (let i = 0; i < length; i++) {
      phase += (f0a + (f0b - f0a) * Math.min(1, i / (end - start))) / rate
      let pulse = 0
      if (start + i < end && phase >= 1) { phase -= 1 - 0.01 * (rand() - 0.5); pulse = 1 + 0.05 * (rand() - 0.5) }
      const g = pulse + 1.94 * g1 - 0.9409 * g2
      g2 = g1; g1 = g
      source[i] = g * 0.03
      excitation[i] = pulse
    }
    for (const [freq, bandwidth] of formants) resonate(source, freq, bandwidth, rate)
    let smooth = 0
    for (let i = 0; i < length; i++) { smooth = excitation[i] + 0.9 * smooth; excitation[i] = 0.1 * smooth + 0.003 * (rand() - 0.5) }
    const hfLevel = 0.02 * (0.5 + rand())
    for (const [freq, bandwidth] of [[4000 + 1000 * rand(), 500], [6000 + 1500 * rand(), 900]]) {
      const branch = Float64Array.from(excitation)
      resonate(branch, freq, bandwidth, rate)
      for (let i = 0; i < length; i++) source[i] += branch[i] * hfLevel
    }
    const attack = ms(15, rate), release = ms(40, rate)
    let previous = 0
    for (let i = 0; i < length && start + i < total; i++) {
      const n = start + i
      let env = n >= end ? 0 : 1
      if (i < attack) env *= 0.5 - 0.5 * Math.cos(Math.PI * i / attack)
      if (n < end && n > end - release) env *= 0.5 - 0.5 * Math.cos(Math.PI * (end - n) / release)
      out[n] += (source[i] - 0.97 * previous) * env * level
      previous = source[i]
    }
    t = end + ms(30 + (rand() < 0.2 ? 300 : 120) * rand(), rate)
  }
  let peak = 0
  for (let n = 0; n < total; n++) peak = Math.max(peak, Math.abs(out[n]))
  for (let n = 0; n < total; n++) out[n] *= 0.5 / peak
  if (options.fricatives) {
    syllables.forEach((syllable, index) => {
      if (index % 2) return
      const kind = Math.floor(rand() * 4)
      const end = syllable + ms(5, rate)
      const begin = Math.max(0, end - ms(30 + 90 * rand(), rate))
      const level = 0.08 + 0.15 * rand()
      const a = Math.exp(-2 * Math.PI * [4500, 2200, 1500, 800][kind] / rate)
      const attack = kind < 2 ? ms(12, rate) : 2
      let lp = 0
      for (let n = begin; n < end; n++) {
        const white = rand() * 2 - 1
        lp = (1 - a) * white + a * lp
        let env = Math.min(1, (n - begin) / attack) * Math.min(1, (end - n) / ms(8, rate))
        if (kind >= 2) env *= n - begin < ms(4, rate) ? 1.6 : 0.7
        out[n] += (white - lp) * env * level
      }
    })
  }
  for (let n = 0; n < total; n++) out[n] += 3e-4 * (rand() + rand() + rand() - 1.5) * 2
  const signal = Float32Array.from(out)
  // 语音包络：前后 10 ms 的峰值
  const step = ms(10, rate)
  const blocks = new Float32Array(Math.ceil(total / step) + 1)
  for (let n = 0; n < total; n++) blocks[Math.floor(n / step)] = Math.max(blocks[Math.floor(n / step)], Math.abs(signal[n]))
  const envelope = new Float32Array(total)
  for (let n = 0; n < total; n++) { const b = Math.floor(n / step); envelope[n] = Math.max(blocks[b], blocks[b - 1] ?? 0, blocks[b + 1] ?? 0) }
  return { signal, syllables, envelope }
}

interface Click { position: number; length: number }

/**
 * 注入咔嗒：0.3–3 ms 指数衰减的宽频（白噪声）或高通（一阶差分）噪声脉冲，峰值比所在位置的语音包络低 6–30 dB
 * （停顿里包络按 0.1 算）。避开音节起点前 20 ms 到起点后 8 ms：那里的瞬态与塞音除阻分不开，检测器按设计不报。
 */
function injectClicks(target: Float32Array, speech: Speech, count: number, seed: number, rate = RATE): Click[] {
  const rand = random(seed)
  const clicks: Click[] = []
  while (clicks.length < count) {
    const position = ms(100, rate) + Math.floor(rand() * (target.length - ms(200, rate)))
    if (clicks.some((click) => Math.abs(click.position - position) < ms(200, rate))) continue
    if (speech.syllables.some((start) => position > start - ms(20, rate) && position < start + ms(8, rate))) continue
    const length = Math.max(2, ms(0.3 + 2.7 * rand(), rate))
    const amplitude = Math.max(0.1, speech.envelope[position]) * 10 ** (-(6 + 24 * rand()) / 20)
    const wide = rand() < 0.5
    const pulse = new Float64Array(length)
    let previous = 0, peak = 0
    for (let i = 0; i < length; i++) {
      const white = rand() * 2 - 1
      pulse[i] = (wide ? white : white - previous) * Math.exp(-4 * i / length)
      previous = white
      peak = Math.max(peak, Math.abs(pulse[i]))
    }
    for (let i = 0; i < length; i++) target[position + i] += pulse[i] / peak * amplitude
    clicks.push({ position, length })
  }
  return clicks.sort((a, b) => a.position - b.position)
}

const covers = (detection: AudioEditMouthClick, click: Click): boolean => detection.startFrame <= click.position + click.length && detection.endFrame >= click.position
const recallOf = (detections: AudioEditMouthClick[], clicks: Click[]): number => clicks.filter((click) => detections.some((d) => covers(d, click))).length
const falseOf = (detections: AudioEditMouthClick[], clicks: Click[]): number => detections.filter((d) => !clicks.some((click) => covers(d, click))).length

function expectWellFormed(detections: AudioEditMouthClick[], total: number, rate = RATE): void {
  detections.forEach((detection, index) => {
    expect(detection.startFrame).toBeGreaterThanOrEqual(32)
    expect(detection.endFrame).toBeLessThanOrEqual(total - 32)
    expect(detection.endFrame).toBeGreaterThan(detection.startFrame)
    expect(detection.endFrame - detection.startFrame).toBeLessThanOrEqual(ms(100, rate))
    expect(detection.peakFrame).toBeGreaterThanOrEqual(detection.startFrame)
    expect(detection.peakFrame).toBeLessThan(detection.endFrame)
    expect(detection.score).toBeGreaterThan(0)
    expect(detection.score).toBeLessThanOrEqual(1)
    if (index > 0) expect(detection.startFrame).toBeGreaterThan(detections[index - 1].endFrame)
  })
}

describe('口水音检测', () => {
  it('类元音里随机注入 30 个咔嗒：灵敏度 50 召回 ≥ 90%，每 10 秒误检 ≤ 1 处', () => {
    // 每段 30 秒、30 个咔嗒；分段看个别段落可以略低（弱咔嗒恰好落在声门脉冲上时分不开），合计不低于 90%
    let found = 0, total = 0
    for (const seed of [1, 2, 3, 4]) {
      const speech = synthSpeech(30, seed)
      const signal = Float32Array.from(speech.signal)
      const clicks = injectClicks(signal, speech, 30, seed * 7 + 1)
      const detections = detectAudioEditMouthClicks([signal], RATE)
      expectWellFormed(detections, signal.length)
      found += recallOf(detections, clicks)
      total += clicks.length
      expect(recallOf(detections, clicks)).toBeGreaterThanOrEqual(25)
      expect(falseOf(detections, clicks)).toBeLessThanOrEqual(3)
    }
    expect(found / total).toBeGreaterThanOrEqual(0.9)
  })

  it('纯净类元音、含 s/sh/t/k 擦音塞音的口播上每 10 秒误检 ≤ 1 处', () => {
    for (const fricatives of [false, true]) {
      const speech = synthSpeech(30, fricatives ? 11 : 3, { fricatives })
      expect(detectAudioEditMouthClicks([speech.signal], RATE).length).toBeLessThanOrEqual(3)
    }
  })

  it('灵敏度越高检出越多：20 → 50 → 80 检出数不减，低灵敏度的每处都被高灵敏度覆盖', () => {
    const speech = synthSpeech(20, 4, { fricatives: true })
    const signal = Float32Array.from(speech.signal)
    injectClicks(signal, speech, 20, 5)
    const runs = [20, 50, 80].map((sensitivity) => detectAudioEditMouthClicks([signal], RATE, { sensitivity }))
    expect(runs[0].length).toBeLessThanOrEqual(runs[1].length)
    expect(runs[1].length).toBeLessThanOrEqual(runs[2].length)
    for (let i = 1; i < runs.length; i++) {
      for (const low of runs[i - 1]) expect(runs[i].some((high) => high.startFrame <= low.startFrame && high.endFrame >= low.endFrame)).toBe(true)
    }
    // 得分表示把握，与灵敏度无关
    const shared = runs[0][0]
    expect(runs[2].find((d) => d.peakFrame === shared.peakFrame)?.score).toBeCloseTo(shared.score, 9)
  })

  it('静音、全零、极短、单声道、只有一侧有咔嗒的立体声、非有限值都不出错', () => {
    expect(detectAudioEditMouthClicks([], RATE)).toEqual([])
    expect(detectAudioEditMouthClicks([new Float32Array(0)], RATE)).toEqual([])
    for (const length of [1, 10, 64, 65, 100, 1000, 5000]) {
      const noisy = Float32Array.from({ length }, (_, i) => (i === length >> 1 ? 0.5 : 0.001 * Math.sin(i)))
      expect(() => detectAudioEditMouthClicks([noisy, noisy], RATE)).not.toThrow()
      expectWellFormed(detectAudioEditMouthClicks([noisy], RATE), length)
    }
    expect(detectAudioEditMouthClicks([new Float32Array(RATE * 3), new Float32Array(RATE * 3)], RATE)).toEqual([])
    const hiss = Float32Array.from({ length: RATE * 3 }, (_, i) => 1e-4 * Math.sin(i * 1.7) * Math.sin(i * 0.013))
    expect(detectAudioEditMouthClicks([hiss], RATE)).toEqual([])
    expect(detectAudioEditMouthClicks([hiss], 0)).toEqual([])
    expect(detectAudioEditMouthClicks([hiss], Number.NaN)).toEqual([])
    for (const sensitivity of [-20, 0, 100, 300, Number.NaN]) expect(() => detectAudioEditMouthClicks([hiss], RATE, { sensitivity, widenMs: -3 })).not.toThrow()

    const speech = synthSpeech(12, 6)
    const left = Float32Array.from(speech.signal)
    const clicks = injectClicks(left, speech, 10, 9)
    const stereo = detectAudioEditMouthClicks([left, speech.signal], RATE)
    expectWellFormed(stereo, left.length)
    expect(recallOf(stereo, clicks)).toBeGreaterThanOrEqual(8)
    expect(falseOf(stereo, clicks)).toBeLessThanOrEqual(1)
    // 两声道相同与单声道结果一致
    expect(detectAudioEditMouthClicks([left, left], RATE)).toEqual(detectAudioEditMouthClicks([left], RATE))

    const broken = Float32Array.from(left)
    broken[RATE * 2] = Number.NaN
    broken[RATE * 5] = Number.POSITIVE_INFINITY
    const repaired = detectAudioEditMouthClicks([broken], RATE)
    expectWellFormed(repaired, broken.length)
    expect(repaired.every((d) => Number.isFinite(d.score))).toBe(true)

    // 贴着文件头的咔嗒：范围离头至少 32 个样本
    const edge = new Float32Array(RATE)
    for (let i = 0; i < edge.length; i++) edge[i] = 2e-4 * Math.sin(i * 2.3)
    for (let i = 10; i < 40; i++) edge[i] += 0.3 * Math.exp(-(i - 10) / 6) * (i % 2 ? 1 : -1)
    expectWellFormed(detectAudioEditMouthClicks([edge], RATE), edge.length)
  })

  it('其他采样率也能用（16 kHz 只有 2–8 kHz 可看，元音里的弱咔嗒和声门脉冲分不太开，只要求不误检）', () => {
    for (const rate of [16000, 22050, 48000]) {
      const speech = synthSpeech(12, 8, { rate })
      const signal = Float32Array.from(speech.signal)
      const clicks = injectClicks(signal, speech, 10, 12, rate)
      const detections = detectAudioEditMouthClicks([signal], rate)
      expectWellFormed(detections, signal.length, rate)
      expect(falseOf(detections, clicks)).toBeLessThanOrEqual(1)
      expect(recallOf(detections, clicks)).toBeGreaterThanOrEqual(rate >= 44100 ? 8 : 3)
    }
  })

  it('分块一致：块大小、截断长度、前后拼接都不改变结果', () => {
    const speech = synthSpeech(12, 7, { fricatives: true })
    const signal = Float32Array.from(speech.signal)
    injectClicks(signal, speech, 12, 3)
    const reference = scanAudioEditMouthClickCandidates([signal], RATE)
    expect(reference.length).toBeGreaterThan(12)
    for (const blockFrames of [1, 7, 33, 1000]) expect(scanAudioEditMouthClickCandidates([signal], RATE, blockFrames)).toEqual(reference)

    const full = detectAudioEditMouthClicks([signal], RATE)
    const before = (list: AudioEditMouthClick[], end: number): AudioEditMouthClick[] => list.filter((d) => d.endFrame < end)
    const after = (list: AudioEditMouthClick[], start: number): AudioEditMouthClick[] => list.filter((d) => d.startFrame >= start)
    for (const cut of [ms(4321.7), ms(7000.3), ms(9876.5)]) {
      const margin = ms(150)
      expect(before(detectAudioEditMouthClicks([signal.subarray(0, cut)], RATE), cut - margin)).toEqual(before(full, cut - margin))
      // 后一段从对齐 20 ms 帧的位置开始，提前 0.5 s 让高通滤波进入稳态
      const offset = Math.floor((cut - ms(500)) / 882) * 882
      const tail = detectAudioEditMouthClicks([signal.subarray(offset)], RATE)
        .map((d) => ({ ...d, startFrame: d.startFrame + offset, endFrame: d.endFrame + offset, peakFrame: d.peakFrame + offset }))
      const expected = after(full, cut)
      const actual = after(tail, cut)
      expect(actual.map(({ score, ...rest }) => ({ ...rest, score: Math.round(score * 1e6) }))).toEqual(expected.map(({ score, ...rest }) => ({ ...rest, score: Math.round(score * 1e6) })))
    }
  })

  it('修复范围：两侧扩大、单段不超过 20 ms、相隔不足 5 ms 的合并，合并后不超过 100 ms', () => {
    const quiet = Float32Array.from({ length: RATE }, (_, i) => 2e-4 * Math.sin(i * 2.3) * Math.cos(i * 0.71))
    const click = (target: Float32Array, at: number, amplitude: number): void => {
      for (let i = 0; i < 30; i++) target[at + i] += amplitude * Math.exp(-i / 6) * (i % 2 ? 1 : -1) * (1 + 0.3 * Math.sin(i * 1.3))
    }
    const single = Float32Array.from(quiet)
    click(single, 20000, 0.05)
    const narrow = detectAudioEditMouthClicks([single], RATE, { widenMs: 0 })
    const wide = detectAudioEditMouthClicks([single], RATE, { widenMs: 3 })
    expect(narrow).toHaveLength(1)
    expect(wide).toHaveLength(1)
    expect(narrow[0].startFrame).toBeLessThanOrEqual(20000)
    expect(narrow[0].endFrame).toBeGreaterThanOrEqual(20010)
    expect(wide[0].startFrame).toBe(narrow[0].startFrame - ms(3))
    expect(wide[0].endFrame).toBe(narrow[0].endFrame + ms(3))
    expect(wide[0].endFrame - wide[0].startFrame).toBeLessThanOrEqual(ms(20))

    // 两处相隔 3 ms 并成一段；相隔 30 ms 分开
    const pair = Float32Array.from(quiet)
    click(pair, 10000, 0.05)
    click(pair, 10000 + 30 + ms(3), 0.04)
    click(pair, 30000, 0.05)
    click(pair, 30000 + ms(30), 0.04)
    const pairs = detectAudioEditMouthClicks([pair], RATE, { widenMs: 0 })
    expect(pairs).toHaveLength(3)
    expect(pairs[0].endFrame).toBeGreaterThanOrEqual(10000 + 30 + ms(3) + 10)

    // 成串的咔啦声（不规则地每 2–6 ms 一下、共 250 ms）：每段不超过 100 ms，彼此不重叠
    const rattle = Float32Array.from(quiet)
    const rand = random(21)
    for (let at = 5000; at < 5000 + ms(250); at += ms(2 + 4 * rand())) click(rattle, at, 0.02 + 0.04 * rand())
    const parts = detectAudioEditMouthClicks([rattle], RATE)
    expectWellFormed(parts, rattle.length)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts.reduce((sum, d) => sum + d.endFrame - d.startFrame, 0)).toBeGreaterThan(ms(200))
  })
})
