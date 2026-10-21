import { describe, expect, it } from 'vitest'
import { aggregateBeatThis, beatThisChunkStarts, beatThisMinimalPostprocess, beatThisSpectrogram, beatThisWindow, BEAT_THIS_MELS, BEAT_THIS_SAMPLE_RATE, meanDownmix } from './beatThis'

/** 每个频点平均分给相邻两个梅尔带的简易滤波器组（只用于形状与稀疏投影测试）。 */
function simpleFilterbank(): Float32Array {
  const bank = new Float32Array(513 * BEAT_THIS_MELS)
  for (let bin = 0; bin < 513; bin++) { const m = Math.min(BEAT_THIS_MELS - 1, Math.floor(bin / 4)); bank[bin * BEAT_THIS_MELS + m] = 0.5; bank[bin * BEAT_THIS_MELS + Math.min(BEAT_THIS_MELS - 1, m + 1)] += 0.5 }
  return bank
}

describe('Beat This! host processing', () => {
  it('splits like split_piece(avoid_short_end=True)', () => {
    // np.arange(-6, 6370, 1488) = [-6, 1482, 2970, 4458, 5946]，最后一个移到 6376 - 1494。
    expect(beatThisChunkStarts(6376)).toEqual([-6, 1482, 2970, 4458, 4882])
    expect(beatThisChunkStarts(100)).toEqual([-6])
    expect(beatThisChunkStarts(1488)).toEqual([-6])
    expect(beatThisChunkStarts(1489)).toEqual([-6, -5])
  })

  it('zero-pads windows and lets earlier windows win overlaps (keep_first)', () => {
    const spectrogram = { frames: 10, mel: Float32Array.from({ length: 10 * BEAT_THIS_MELS }, (_, i) => Math.floor(i / BEAT_THIS_MELS) + 1), chroma: new Float32Array(120) }
    const window = beatThisWindow(spectrogram, -2, 6)
    expect(Array.from({ length: 6 }, (_, frame) => window[frame * BEAT_THIS_MELS])).toEqual([0, 0, 1, 2, 3, 4])
    const logits = [{ beat: Float32Array.of(9, 1, 1, 1, 1, 9), downbeat: new Float32Array(6) }, { beat: Float32Array.of(9, 2, 2, 2, 2, 9), downbeat: new Float32Array(6) }]
    expect(Array.from(aggregateBeatThis(6, [-1, 1], logits, 6, 1).beat)).toEqual([1, 1, 1, 1, 2, 2])
  })

  it('picks ±3-frame maxima above zero, merges adjacent peaks and snaps downbeats to beats', () => {
    const beat = new Float32Array(200).fill(-5), downbeat = new Float32Array(200).fill(-5)
    beat[10] = 2; beat[50] = 3; beat[51] = 3; beat[90] = -0.5; beat[120] = 1; beat[122] = 0.5
    downbeat[11] = 1; downbeat[121] = 2
    const result = beatThisMinimalPostprocess(beat, downbeat)
    expect(result.beats).toEqual([0.2, 1.01, 2.4])
    expect(result.downbeats).toEqual([0.2, 2.4])
  })

  it('builds the log-mel input with one frame per hop and puts a 440 Hz tone in pitch class A', () => {
    const seconds = 1
    const tone = Float32Array.from({ length: BEAT_THIS_SAMPLE_RATE * seconds }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / BEAT_THIS_SAMPLE_RATE))
    const spectrogram = beatThisSpectrogram(tone, simpleFilterbank())
    expect(spectrogram.frames).toBe(1 + Math.floor(tone.length / 441))
    expect(spectrogram.mel.every(value => value >= 0 && Number.isFinite(value))).toBe(true)
    const middle = Math.floor(spectrogram.frames / 2)
    const pitch = Array.from(spectrogram.chroma.subarray(middle * 12, middle * 12 + 12))
    expect(pitch.indexOf(Math.max(...pitch))).toBe(9)
  })

  it('downmixes channels by arithmetic mean', () => {
    expect(Array.from(meanDownmix([Float32Array.of(1, 0.5), Float32Array.of(-1, 0.5)]))).toEqual([0, 0.5])
  })
})
