import { describe, expect, it } from 'vitest'
import { db, effect, expectSamples, RATE, rms, run, sine, steadyGain, stereo } from './audioEffects.testSupport'

/** RMS 为 `level` dBFS 的正弦幅度。 */
const amplitudeFor = (level: number): number => Math.SQRT2 * 10 ** (level / 20)
const concat = (...parts: Float32Array[]): Float32Array => { const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { joined.set(part, offset); offset += part.length } return joined }
const windowGain = (output: Float32Array, input: Float32Array, from: number, to: number): number => { const [start, end] = [Math.round(from * RATE), Math.round(to * RATE)]; return db(rms(output, start, end) / rms(input, start, end)) }

describe('动态类效果', () => {
  it('噪声门：声明 1.5 毫秒预判延迟；高于阈值的声音门全开、逐样本为延迟后的原声；低于阈值压低“衰减量”', async () => {
    const loud = sine(300, .1, RATE)
    const open = await run([effect('noise_gate')], stereo(loud))
    expect(open.latency).toBe(72)
    expectSamples(open.output[0].subarray(RATE / 10), index => loud[RATE / 10 + index - 72])
    const quiet = sine(300, .001, RATE)
    expect(steadyGain((await run([effect('noise_gate')], stereo(quiet))).output[0], quiet)).toBeCloseTo(-30, 1)
    expect(steadyGain((await run([effect('noise_gate', { reduction: 60 })], stereo(quiet))).output[0], quiet)).toBeCloseTo(-60, 1)
    expect(steadyGain((await run([effect('noise_gate', { threshold: -70 })], stereo(quiet))).output[0], quiet)).toBeCloseTo(0, 3)
  })
  it('噪声门：声音停下后先保持、再按释放时间渐渐关上，停顿里的底噪被压低；说话时不受影响', async () => {
    const speech = sine(300, .1, RATE / 2); const room = sine(300, .0005, RATE)
    const input = concat(speech, room)
    const output = (await run([effect('noise_gate')], stereo(input))).output[0]
    expect(Math.abs(windowGain(output, input, .2, .48))).toBeLessThan(.01)
    // 0.5 秒处说话停止：保持 50 毫秒 + 包络回落，之后 150 毫秒内降到 -30 dB。
    expect(windowGain(output, input, .52, .55)).toBeGreaterThan(-3)
    expect(windowGain(output, input, .9, 1.5)).toBeCloseTo(-30, 0)
  })
  it('语音音量级别：轻声抬到目标电平、大声压到目标电平，受最大提升/衰减限制', async () => {
    const quiet = sine(300, amplitudeFor(-36), RATE * 6)
    const lifted = (await run([effect('speech_leveler', { max_boost: 30 })], stereo(quiet))).output[0]
    expect(db(rms(lifted, RATE * 5))).toBeCloseTo(-18, 0)
    const limited = (await run([effect('speech_leveler')], stereo(quiet))).output[0]
    expect(db(rms(limited, RATE * 5))).toBeCloseTo(-24, 0)
    const loud = sine(300, amplitudeFor(-6), RATE * 6)
    expect(db(rms((await run([effect('speech_leveler')], stereo(loud))).output[0], RATE * 5))).toBeCloseTo(-18, 0)
    // 片段开头起步快：1 秒内就接近目标。
    expect(Math.abs(db(rms(lifted, RATE * .8, RATE)) + 18)).toBeLessThan(3)
  })
  it('语音音量级别：停顿（低于噪声电平）保持当前增益，不把底噪抬到最大提升；增益变化平滑、没有逐样本跳变', async () => {
    const speech = sine(300, amplitudeFor(-24), RATE * 3); const pause = sine(300, amplitudeFor(-70), RATE * 3)
    const input = concat(speech, pause)
    const output = (await run([effect('speech_leveler')], stereo(input))).output[0]
    expect(windowGain(output, input, 2, 3)).toBeCloseTo(6, 0)
    expect(windowGain(output, input, 4.5, 6)).toBeCloseTo(6, 0)
    let jump = 0
    const gainOf = (from: number): number => db(rms(output, from, from + 480) / rms(input, from, from + 480))
    for (let index = RATE; index + 480 <= input.length; index += 480) jump = Math.max(jump, Math.abs(gainOf(index) - gainOf(index - 480)))
    expect(jump).toBeLessThan(.5)
  })
  it('多段压缩器：压缩量全 0、输出 0 dB 时幅频平直（含分频点）；只压高频段时高频变轻、低频不变；输出增益整体缩放', async () => {
    for (const frequency of [50, 200, 700, 3000, 10000]) {
      const tone = sine(frequency, .5, RATE)
      expect(Math.abs(steadyGain((await run([effect('multiband_compressor', { low_amount: 0, mid_amount: 0, high_amount: 0 })], stereo(tone))).output[0], tone))).toBeLessThan(.02)
    }
    const highOnly = { low_amount: 0, mid_amount: 0, high_amount: 80 }
    const hiss = sine(8000, .9, RATE); const bass = sine(100, .9, RATE)
    expect(steadyGain((await run([effect('multiband_compressor', highOnly)], stereo(hiss))).output[0], hiss)).toBeLessThan(-6)
    expect(Math.abs(steadyGain((await run([effect('multiband_compressor', highOnly)], stereo(bass))).output[0], bass))).toBeLessThan(.1)
    const tone = sine(1000, .5, RATE)
    expect(steadyGain((await run([effect('multiband_compressor', { low_amount: 0, mid_amount: 0, high_amount: 0, output: 6 })], stereo(tone))).output[0], tone)).toBeCloseTo(6, 1)
    // 默认（三段各 30）：大声被收紧，小声被补偿抬高。
    const quiet = sine(1000, .003, RATE); const loud = sine(1000, .9, RATE)
    const quietGain = steadyGain((await run([effect('multiband_compressor')], stereo(quiet))).output[0], quiet)
    expect(quietGain).toBeGreaterThan(3)
    expect(steadyGain((await run([effect('multiband_compressor')], stereo(loud))).output[0], loud)).toBeLessThan(quietGain - 3)
  })
})
