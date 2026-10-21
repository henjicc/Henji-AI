import { describe, expect, it } from 'vitest'
import { CLAP_FRAMES, CLAP_MEL_BINS, CLAP_WINDOW_SAMPLES, clapLogMel, clapWindow } from './clapFeatures'
import { CLAP_REFERENCE, synthesizeClapSignal } from '../../../tests/fixtures/sound-library/clapReference'

const SR = 48_000

describe('CLAP 对数梅尔谱与 transformers ClapFeatureExtractor 一致', () => {
  it.each(CLAP_REFERENCE.signals.map(signal => [signal.kind, signal] as const))('%s', (_kind, reference) => {
    const mel = clapLogMel(clapWindow(synthesizeClapSignal(reference.kind), 7 * SR))
    expect(mel.length).toBe(CLAP_FRAMES * CLAP_MEL_BINS)
    let worst = 0
    reference.melSamples.forEach((value, index) => { worst = Math.max(worst, Math.abs(mel[index * reference.melStride] - value)) })
    // dB 域逐点误差（官方中间结果按 complex64 存放），远小于模型对输入的敏感度；向量一致性见原生测试。
    expect(worst).toBeLessThan(0.01)
    expect(mel.reduce((sum, value) => sum + value, 0) / mel.length).toBeCloseTo(reference.melMean, 3)
  })

  it('短声音按 repeatpad 重复后补零，长声音以击中点为中心确定性截取', () => {
    const short = Float32Array.from({ length: 200_000 }, (_, i) => i + 1)
    const padded = clapWindow(short)
    expect(padded[199_999]).toBe(200_000); expect(padded[200_000]).toBe(1); expect(padded[399_999]).toBe(200_000); expect(padded[400_000]).toBe(0)
    const long = Float32Array.from({ length: 20 * SR }, (_, i) => i)
    expect(clapWindow(long, 15 * SR)[0]).toBe(10 * SR)
    expect(clapWindow(long, 19 * SR)[0]).toBe(10 * SR)
    expect(clapWindow(long, 0)[0]).toBe(0)
    expect(clapWindow(long, 15 * SR)).toHaveLength(CLAP_WINDOW_SAMPLES)
  })
})
