import { describe, expect, it } from 'vitest'
import { AudioEditSoundStatsCollector, compareAudioEditSoundChecks, gatedAudioEditLoudness, summarizeAudioEditSound, type AudioEditLoudnessTimeline } from './soundCheck'

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
const stats = (channels: number, parts: Array<[number, (index: number) => number]>, blockFrames = 1000) => {
  const data = pcm(channels, parts)
  const collector = new AudioEditSoundStatsCollector(RATE, channels)
  // 分块送入，结果与块大小无关
  for (let at = 0; at < data.length; at += blockFrames * channels) collector.push(data.subarray(at, at + blockFrames * channels))
  return collector.finish()
}
const flatLoudness = (seconds: number, lufs: number): AudioEditLoudnessTimeline => ({ integratedLufs: lufs, loudnessRangeLu: 0, truePeakDbtp: -3, momentaryLufs: Array.from({ length: Math.round(seconds * 10) }, (_, index) => index < 3 ? -120.7 : lufs) })
const options = { offsetSeconds: 0, windowSeconds: 10, silenceDb: -40, longPauseSeconds: 0.8, includeWindows: false }

describe('采样级统计', () => {
  it('满刻度与平顶都算削波，相距不到 50 毫秒的合成一处；分块大小不影响结果', () => {
    const parts: Array<[number, (index: number) => number]> = [
      [1, sine(200, 0.5)],
      // 1.0–1.01 秒满刻度
      [0.01, () => 1],
      [1, sine(200, 0.5)],
      // 2.01 秒起录音时削过再衰减的平顶：一串完全相同的 0.6
      [0.005, () => 0.6],
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

  it('普通正弦与说话般起伏的声音不算削波', () => {
    expect(stats(1, [[2, sine(440, 0.9)]]).clips).toEqual([])
  })

  it('每秒给出电源频率及谐波占的能量比例：纯 50 Hz 接近 1，宽带噪声接近 0', () => {
    const hum = stats(1, [[2, sine(50, 0.01)]]).hum
    expect(hum).toHaveLength(2)
    expect(hum[0].mains50).toBeGreaterThan(0.95)
    expect(hum[0].mains60).toBeLessThan(0.05)
    expect(stats(1, [[2, noise(0.01)]]).hum[0].mains50).toBeLessThan(0.02)
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

  it('底噪按安静片段估计（静音掉的段不算）；安静处有 50 Hz 时报疑似嗡声', () => {
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
