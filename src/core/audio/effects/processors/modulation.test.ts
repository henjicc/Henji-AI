import { describe, expect, it } from 'vitest'
import { AudioEffectChain } from '../audioEffectChain'
import { db, effect, expectSamples, isFiniteSignal, noise, peak, RATE, rms, run, sine, steadyGain, stereo } from './audioEffects.testSupport'

/** 从 `start` 起单独跑一段（`locate` 告诉效果链这段在片段里的位置）。 */
async function runFrom(builtinId: string, params: Record<string, unknown>, input: Float32Array[], start: number): Promise<Float32Array[]> {
  return (await run([effect(builtinId, params)], input.map(channel => channel.slice(start)), start)).output
}

describe('调制类效果', () => {
  it('和声：混合量 0 原样；深度 0、单声部、混合量 100 是 12 毫秒的精确延迟；默认参数电平不失控、确实改变了声音', async () => {
    const input = stereo(noise(RATE, .3, 11), sine(440, .3, RATE))
    expectSamples((await run([effect('chorus', { mix: 0 })], input)).output[0], input[0])
    const delayed = (await run([effect('chorus', { depth: 0, voices: 1, mix: 100 })], input)).output[0]
    expectSamples(delayed, index => index < 576 ? 0 : input[0][index - 576])
    const tone = sine(440, .5, RATE * 2)
    const [left, right] = (await run([effect('chorus')], stereo(tone))).output
    // 电平不失控：不会比原声更响；宽带声音的电平在原声与 -6 dB 之间（干声与互不相关的声部线性混合）。
    expect(peak(left)).toBeLessThan(.505)
    const hiss = noise(RATE * 2, .3, 13)
    const level = steadyGain((await run([effect('chorus')], stereo(hiss))).output[0], hiss)
    expect(level).toBeLessThan(.5); expect(level).toBeGreaterThan(-6)
    expect(rms(Float32Array.from(left, (value, index) => value - tone[index]), RATE)).toBeGreaterThan(.01)
    // 立体声：左右的摆动相位错开，两个声道不同。
    expect(rms(Float32Array.from(left, (value, index) => value - right[index]), RATE)).toBeGreaterThan(.005)
  })
  it('镶边：固定延迟、无反馈时在 sr/(2·延迟) 处形成梳状凹口；最大反馈时宽带电平仍稳定', async () => {
    // 深度 0：延迟固定 0.25 毫秒（12 个样本），混合量 50 → y = (x + x[n-12]) / 2，2 kHz 被抵消、1 kHz 为 -3 dB。
    const comb = { depth: 0, feedback: 0, mix: 50 }
    expect(steadyGain((await run([effect('flanger', comb)], stereo(sine(2000, .3, RATE)))).output[0], sine(2000, .3, RATE))).toBeLessThan(-60)
    expect(steadyGain((await run([effect('flanger', comb)], stereo(sine(1000, .3, RATE)))).output[0], sine(1000, .3, RATE))).toBeCloseTo(-3.01, 1)
    const hiss = noise(RATE * 2, .3, 5)
    for (const params of [{}, { feedback: 95 }, { feedback: 95, depth: 100, rate: 5, mix: 100 }]) {
      const output = (await run([effect('flanger', params)], stereo(hiss))).output
      expect(isFiniteSignal(output)).toBe(true)
      expect(Math.abs(db(rms(output[0], RATE / 2) / rms(hiss, RATE / 2)))).toBeLessThan(6)
    }
  })
  it('移相器：深度 0 时凹口在全通相位 -180° 的频率（8 级、200 Hz 处最深的凹口约 1 kHz），200 Hz 原样通过；最大反馈电平稳定；级数可原地改', async () => {
    const still = { depth: 0, feedback: 0, mix: 50 }
    const w = Math.tan(Math.PI * 200 / RATE)
    const notch = RATE / Math.PI * Math.atan(w * Math.tan(78.75 / 180 * Math.PI))
    expect(steadyGain((await run([effect('phaser', still)], stereo(sine(notch, .3, RATE)))).output[0], sine(notch, .3, RATE))).toBeLessThan(-40)
    expect(Math.abs(steadyGain((await run([effect('phaser', still)], stereo(sine(200, .3, RATE)))).output[0], sine(200, .3, RATE)))).toBeLessThan(.05)
    const hiss = noise(RATE * 2, .3, 9)
    for (const params of [{}, { feedback: 95 }, { feedback: 95, depth: 100, rate: 5, stages: '12' }]) {
      const output = (await run([effect('phaser', params)], stereo(hiss))).output
      expect(isFiniteSignal(output)).toBe(true)
      expect(Math.abs(db(rms(output[0], RATE / 2) / rms(hiss, RATE / 2)))).toBeLessThan(6)
    }
    const chain = new AudioEffectChain(RATE, 2); await chain.sync([effect('phaser')])
    const block = stereo(noise(RATE, .3)); chain.process(block, RATE)
    expect(await chain.sync([effect('phaser', { stages: '4' })])).toBe(false)
    chain.process(block, RATE); expect(isFiniteSignal(block)).toBe(true); chain.dispose()
  })
  it('振荡相位按片段内位置对齐：从中间某处开始（locate）处理，延迟线填满后与从头连续处理逐样本相同', async () => {
    const input = stereo(noise(RATE * 2, .3, 21), noise(RATE * 2, .3, 22))
    for (const [builtinId, params] of [['chorus', { voices: 4, depth: 100 }], ['flanger', { feedback: 0 }], ['phaser', { feedback: 0 }]] as const) {
      const whole = (await run([effect(builtinId, params)], input, 0)).output
      const start = RATE / 2 + 123
      const part = await runFrom(builtinId, params, input, start)
      const settle = RATE / 10
      for (const channel of [0, 1]) expectSamples(part[channel].subarray(settle), whole[channel].subarray(start + settle), 6)
    }
    // 有反馈时状态最终也收敛到同一结果。
    const whole = (await run([effect('flanger')], input, 0)).output
    const part = await runFrom('flanger', {}, input, RATE / 2)
    expectSamples(part[0].subarray(RATE / 2), whole[0].subarray(RATE), 6)
  })
})
