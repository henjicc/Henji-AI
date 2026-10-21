import { describe, expect, it } from 'vitest'
import { BEAT_THIS_MELS, BEAT_THIS_SAMPLE_RATE, beatThisSpectrogram } from './beatThis'
import { barPositionsFromDownbeats, beatGridQuality, buildMusicAnalysis, refineBeatsToOnsets } from './musicAnalysis'

const SR = BEAT_THIS_SAMPLE_RATE
function filterbank(): Float32Array {
  const bank = new Float32Array(513 * BEAT_THIS_MELS)
  for (let bin = 0; bin < 513; bin++) bank[bin * BEAT_THIS_MELS + Math.min(BEAT_THIS_MELS - 1, Math.floor(bin / 4))] = 1
  return bank
}
/** 在给定时刻放短促的噪声击打，其间是安静的持续音。 */
function clickTrack(times: readonly number[], seconds: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * SR))
  let seed = 3
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.02 * Math.sin(2 * Math.PI * 220 * i / SR)
  for (const time of times) {
    const start = Math.round(time * SR)
    for (let k = 0; k < 600 && start + k < pcm.length; k++) { seed = (seed * 16807) % 2147483647; pcm[start + k] += 0.8 * Math.exp(-k / 120) * (seed / 2147483647 * 2 - 1) }
  }
  return pcm
}

describe('music structure analysis', () => {
  it('numbers bar positions from downbeats and treats a missed downbeat as a regular double bar', () => {
    const beats = Array.from({ length: 19 }, (_, i) => i * 0.5)
    // 下拍：0、4、12（漏检 8）、15（3 拍的不规整小节）。
    const result = barPositionsFromDownbeats(beats, [0, 2, 6, 7.5])
    expect(result.beatsPerBar).toBe(4)
    expect(result.positions.slice(0, 12)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3])
    expect(result.positions.slice(12, 15)).toEqual([-1, -1, -1])
    expect(result.positions.slice(15)).toEqual([0, 1, 2, 3])
    // 弱起按规整小节倒推。
    expect(barPositionsFromDownbeats([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], [1, 3]).positions.slice(0, 2)).toEqual([2, 3])
  })

  it('refines 20 ms grid beats to the actual attack', () => {
    const attacks = [0.5, 1.0, 1.5, 2.0]
    const refined = refineBeatsToOnsets(attacks.map(time => time + 0.018), clickTrack(attacks, 2.5))
    refined.forEach((time, i) => expect(Math.abs(time - attacks[i])).toBeLessThan(0.006))
  })

  it('measures grid regularity and coverage', () => {
    expect(beatGridQuality(Array.from({ length: 40 }, (_, i) => i * 0.5), 20)).toMatchObject({ regularity: 1, tempo: 120 })
    let seed = 11
    const rubato = [0]
    for (let i = 1; i < 40; i++) { seed = (seed * 16807) % 2147483647; rubato.push(rubato[i - 1] + 0.35 + 0.5 * seed / 2147483647) }
    expect(beatGridQuality(rubato, rubato.at(-1)! + 1).regularity).toBeLessThan(0.75)
  })

  it('accepts a steady pulse and rejects free rhythm with a user-facing reason', () => {
    const steady = Array.from({ length: 48 }, (_, i) => 0.3 + i * 0.5)
    const pcm = clickTrack(steady, 25)
    const accepted = buildMusicAnalysis({ mono: pcm, spectrogram: beatThisSpectrogram(pcm, filterbank()), beats: steady, downbeats: steady.filter((_, i) => i % 4 === 0), beatSource: 'beat_this' })
    expect(accepted).toMatchObject({ suitable: true, beatsPerBar: 4 })
    expect(accepted.tempo).toBeCloseTo(120, 0)
    expect(accepted.chroma).toHaveLength(48 * 12)
    expect(accepted.timbre).toHaveLength(48 * 12)
    expect(accepted.loudness).toHaveLength(48)
    let seed = 5
    const free = [0.3]
    for (let i = 1; i < 40; i++) { seed = (seed * 16807) % 2147483647; free.push(free[i - 1] + 0.3 + 0.6 * seed / 2147483647) }
    const freePcm = clickTrack(free, free.at(-1)! + 1)
    const rejected = buildMusicAnalysis({ mono: freePcm, spectrogram: beatThisSpectrogram(freePcm, filterbank()), beats: free, downbeats: free.filter((_, i) => i % 3 === 0), beatSource: 'beat_this' })
    expect(rejected.suitable).toBe(false)
    expect(rejected.unsuitableReason).toContain('自由')
    expect(buildMusicAnalysis({ mono: freePcm, spectrogram: beatThisSpectrogram(freePcm, filterbank()), beats: free.slice(0, 8), downbeats: [], beatSource: 'beat_this' }).unsuitableReason).toContain('节拍')
  })
})
