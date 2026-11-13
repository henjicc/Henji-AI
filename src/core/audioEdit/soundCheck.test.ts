import { describe, expect, it } from 'vitest'
import { AudioEditHumCollector, AudioEditSoundStatsCollector, audioEditNoiseFrames, compareAudioEditSoundChecks, gatedAudioEditLoudness, summarizeAudioEditSound, type AudioEditLoudnessTimeline } from './soundCheck'

const RATE = 8000
/** 交错 PCM：每段 [秒数, 每个采样的取值函数(全局采样序号)] 依次拼接 */
function pcm(channels: number, parts: Array<[number, (index: number) => number]>): Float32Array {
  const total = parts.reduce((sum, [seconds]) => sum + Math.round(seconds * RATE), 0)
  const out = new Float32Array(total * channels)
  let at = 0
  for (const [seconds, value] of parts) {
    for (let index = 0; index < Math.round(seconds * RATE); index++, at++) for (let channel = 0; channel < channels; channel++) out[at * channels + channel] = value(at)
  }
  return out
}
const sine = (frequency: number, amplitude: number) => (index: number) => amplitude * Math.sin(2 * Math.PI * frequency * index / RATE)
const silent = () => 0
/** 确定性的宽带噪声 */
const noise = (amplitude: number) => { let seed = 1; return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return amplitude * (seed / 1073741824 - 1) } }
/** 与工作线程同样两遍：第一遍电平、削波、非语音片段，第二遍只在非语音片段里估嗡声 */
const stats = (channels: number, parts: Array<[number, (index: number) => number]>, blockFrames = 1000) => {
  const data = pcm(channels, parts)
  const collector = new AudioEditSoundStatsCollector(RATE, channels)
  // 分块送入，结果与块大小无关
  for (let at = 0; at < data.length; at += blockFrames * channels) collector.push(data.subarray(at, at + blockFrames * channels))
  const first = collector.finish()
  const hum = new AudioEditHumCollector(RATE, channels, audioEditNoiseFrames(first))
  for (let at = 0; at < data.length; at += blockFrames * channels) hum.push(data.subarray(at, at + blockFrames * channels))
  return { ...first, hum: hum.finish() }
}
/** 有高频的“说话”：宽带噪声，RMS 约为幅度减 4.8 dB */
const voice = (amplitude: number) => noise(amplitude)
const flatLoudness = (seconds: number, lufs: number): AudioEditLoudnessTimeline => ({ integratedLufs: lufs, loudnessRangeLu: 0, truePeakDbtp: -3, momentaryLufs: Array.from({ length: Math.round(seconds * 10) }, (_, index) => index < 3 ? -120.7 : lufs) })
const options = { offsetSeconds: 0, windowSeconds: 10, longPauseSeconds: 0.8, includeWindows: false }

describe('采样级统计', () => {
  it('同一声道连续 3 个以上采样接近满刻度才算削波，相距不到 50 毫秒的合成一处；分块大小不影响结果', () => {
    const parts: Array<[number, (index: number) => number]> = [
      [1, sine(200, 0.5)],
      // 1.0–1.01 秒满刻度
      [0.01, () => 1],
      [1, sine(200, 0.5)],
      // 2.01 秒起 -0.05 dBFS 的平顶（录音时削掉的峰）
      [0.005, () => 0.995],
      [1, sine(200, 0.5)],
    ]
    const small = stats(2, parts, 333), large = stats(2, parts, 8000)
    expect(small.clips).toEqual(large.clips)
    expect(small.clips).toHaveLength(2)
    expect(small.clips[0].startFrame).toBe(RATE)
    expect(small.clips[0].endFrame).toBe(RATE + 80)
    expect(small.clips[1].startFrame).toBe(Math.round(2.01 * RATE))
    expect(Array.from(small.levelsDb)).toEqual(Array.from(large.levelsDb))
  })

  it('离满刻度有余量的平坦段不算削波：16 位录音加增益后波峰处相邻采样相等、压到 -1 dBFS 的峰', () => {
    // 真实口播（16 位、约 -39 LUFS）匹配响度加 23 dB 后的样子：波峰波谷处 3–4 个量化值相同的采样，幅度 -10～-4 dBFS，真峰值 -1 dBTP
    const quantized = (index: number) => Math.round(sine(30, 0.34)(index) * 2400) / 2400
    const limited = (index: number) => Math.max(-0.8913, Math.min(0.8913, sine(200, 1.2)(index)))
    expect(stats(2, [[2, quantized], [2, limited]]).clips).toEqual([])
    // 单个超过满刻度的采样（浮点成品转整数时一定削掉）也算；一串里每个采样只计一次
    expect(stats(1, [[0.5, sine(200, 0.5)], [1 / RATE, () => 1.2], [0.5, sine(200, 0.5)]]).clips).toMatchObject([{ samples: 1 }])
    expect(stats(1, [[0.5, sine(200, 0.5)], [5 / RATE, () => 1.2], [0.5, sine(200, 0.5)]]).clips).toMatchObject([{ startFrame: RATE / 2, endFrame: RATE / 2 + 5, samples: 5 }])
  })

  it('普通正弦与说话般起伏的声音不算削波', () => {
    expect(stats(1, [[2, sine(440, 0.9)]]).clips).toEqual([])
  })

  it('嗡声只在非语音帧里累计，每凑满一秒给出电源频率及谐波的能量占比：纯 50 Hz 接近 1，宽带噪声接近 0；隔着说话拼起来也同相', () => {
    const all = (seconds: number) => new Uint8Array(seconds * 100).fill(1)
    const run = (seconds: number, value: (index: number) => number, mask = all(seconds)) => { const collector = new AudioEditHumCollector(RATE, 1, mask); collector.push(pcm(1, [[seconds, value]])); return collector.finish() }
    const hum = run(2, sine(50, 0.01))
    expect(hum).toHaveLength(2)
    expect(hum[0].mains50).toBeGreaterThan(0.95)
    expect(hum[0].mains60).toBeLessThan(0.05)
    expect(run(2, noise(0.01))[0].mains50).toBeLessThan(0.02)
    // 每隔 0.3 秒有 0.2 秒被说话占去（不计入），剩下的片段拼起来仍是同相的 50 Hz
    const gappy = new Uint8Array(400).map((_, index) => index % 30 < 20 ? 1 : 0)
    const pieces = run(4, sine(50, 0.01), gappy)
    expect(pieces.length).toBeGreaterThanOrEqual(2)
    expect(pieces[0].mains50).toBeGreaterThan(0.95)
  })
})

describe('分段响度', () => {
  it('按 BS.1770 门限积分：恒定响度的块积分就是它本身，低于 -70 的块不算', () => {
    expect(gatedAudioEditLoudness([-20, -20, -20, -120])).toBeCloseTo(-20, 5)
    expect(gatedAudioEditLoudness([-120.7, -80])).toBeNull()
    // 比平均轻 10 LU 以上的块被相对门限去掉
    expect(gatedAudioEditLoudness([-20, -20, -45])).toBeCloseTo(-20, 5)
  })
})

describe('汇总读回', () => {
  // 3 秒说话、1.2 秒静音、3 秒说话、0.5 秒静音（结尾）
  const speech = stats(1, [[3, sine(300, 0.3)], [1.2, silent], [3, sine(300, 0.3)], [0.5, silent]])

  it('时间是剪后作品时间：分析起点的偏移加到每个位置上；过长停顿按口播检测时长判定，结尾静音单列', () => {
    const result = summarizeAudioEditSound(speech, flatLoudness(7.7, -18), { ...options, offsetSeconds: 20 })
    expect(result.startSeconds).toBe(20)
    expect(result.endSeconds).toBeCloseTo(27.7, 2)
    expect(result.silence.longPauseCount).toBe(1)
    expect(result.silence.longPauses[0].startSeconds).toBeCloseTo(23, 1)
    expect(result.silence.longPauses[0].seconds).toBeCloseTo(1.2, 1)
    expect(result.silence.trailingSeconds).toBeCloseTo(0.5, 1)
    expect(result.silence.leadingSeconds).toBe(0)
    expect(result.issues.some(issue => issue.includes('停顿超过 0.8 秒'))).toBe(true)
  })

  it('默认不给全部分段，includeWindows 时逐段给出；关键段标出比整体响 4 LU 以上的段', () => {
    // 20 秒：前 10 秒 -20，后 10 秒 -12
    const long = stats(1, [[20, sine(300, 0.2)]])
    const loudness: AudioEditLoudnessTimeline = { integratedLufs: -16, loudnessRangeLu: 6, truePeakDbtp: -2, momentaryLufs: Array.from({ length: 200 }, (_, index) => index < 100 ? -20 : -12) }
    const brief = summarizeAudioEditSound(long, loudness, options)
    expect(brief.windows).toBeUndefined()
    expect(brief.keyWindows.map(window => [window.startSeconds, window.note])).toEqual([[0, 'quietest'], [10, 'loudest']])
    const detailed = summarizeAudioEditSound(long, loudness, { ...options, includeWindows: true })
    expect(detailed.windows?.map(window => window.lufs)).toEqual([-20, -12])
    expect(detailed.windows?.[0].peakDbfs).toBeCloseTo(-14, 0)
  })

  it('停顿门限相对这段声音自己的电平：整体约 -40 dBFS 的轻声录音里，比 -40 还轻的轻声不算停顿', () => {
    // 说话约 -40 dBFS，中间 1.5 秒轻声约 -46 dBFS（低于口播批量设置的 -40 dBFS，但仍是说话），之后 3 秒真正的停顿（底噪约 -75 dBFS）
    const quiet = stats(1, [[4, voice(0.017)], [1.5, voice(0.0085)], [3, voice(0.017)], [3, voice(0.0003)], [3, voice(0.017)]])
    const result = summarizeAudioEditSound(quiet, flatLoudness(14.5, -40), options)
    expect(result.silence.thresholdDbfs).toBeLessThan(-55)
    expect(result.silence.longPauseCount).toBe(1)
    expect(result.silence.longPauses[0].startSeconds).toBeCloseTo(8.5, 1)
    expect(result.noise.floorDbfs).toBeCloseTo(-75, 0)
  })

  it('停顿都被静音掉的成品估不出底噪与嗡声，不拿说话里的轻声顶数', () => {
    const muted = stats(1, [[3, voice(0.1)], [0.3, silent], [3, voice(0.03)], [0.3, silent], [3, voice(0.1)]])
    const result = summarizeAudioEditSound(muted, flatLoudness(9.6, -20), options)
    expect(result.noise).toMatchObject({ floorDbfs: null, rating: 'unknown', hum: { status: 'unknown' } })
  })

  it('底噪只在非语音片段里估（静音掉的段不算）；停顿处有 50 Hz 时报疑似嗡声', () => {
    const humming = stats(1, [[3, sine(300, 0.3)], [4, sine(50, 0.003)], [3, sine(300, 0.3)], [1, silent]])
    const result = summarizeAudioEditSound(humming, flatLoudness(11, -20), options)
    expect(result.noise.hum).toMatchObject({ status: 'suspected', frequencyHz: 50 })
    // 0.003 的正弦约 -53.5 dBFS
    expect(result.noise.floorDbfs).toBeCloseTo(-53.5, 0)
    expect(result.noise.rating).toBe('audible')
    const clean = summarizeAudioEditSound(stats(1, [[3, sine(300, 0.3)], [4, noise(0.0005)], [3, sine(300, 0.3)]]), flatLoudness(10, -20), options)
    expect(clean.noise.hum.status).toBe('none')
    expect(clean.noise.rating).toBe('clean')
  })

  it('安静的秒数不够时嗡声为 unknown；离目标响度超过 1 LU、真峰值高于 -1 dBTP 都列进问题', () => {
    const result = summarizeAudioEditSound(stats(1, [[2, sine(300, 0.3)]]), { integratedLufs: -20, loudnessRangeLu: 2, truePeakDbtp: -0.4, momentaryLufs: [] }, { ...options, targetLufs: -16 })
    expect(result.noise.hum.status).toBe('unknown')
    expect(result.loudness.targetLufs).toBe(-16)
    expect(result.issues.join('')).toMatch(/离目标 -16 LUFS 差 -4 LU[\s\S]*真峰值 -0.4 dBTP/)
  })

  it('前后两次读回给出本次减上次的差值，任一次测不出时为 null', () => {
    const before = summarizeAudioEditSound(speech, flatLoudness(7.7, -22), options)
    const after = summarizeAudioEditSound(stats(1, [[3, sine(300, 0.3)], [0.3, silent], [3, sine(300, 0.3)]]), { ...flatLoudness(6.3, -16), truePeakDbtp: -1 }, options)
    expect(compareAudioEditSoundChecks(before, after, 't')).toMatchObject({ checkedAt: 't', integratedLufs: 6, truePeakDbtp: 2, durationSeconds: -1.4, longPauseCount: -1, clippingCount: 0 })
    expect(compareAudioEditSoundChecks(before, { ...after, loudness: { ...after.loudness, integratedLufs: null } }, 't').integratedLufs).toBeNull()
  })
})
