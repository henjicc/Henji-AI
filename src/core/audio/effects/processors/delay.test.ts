import { describe, expect, it } from 'vitest'
import { AudioEffectChain } from '../audioEffectChain'
import { effect, expectSamples, noise, peak, RATE, run, sine, stereo } from './audioEffects.testSupport'

const impulse = (length: number, at = 0): Float32Array => { const data = new Float32Array(length); data[at] = 1; return data }
const energy = (data: Float32Array, from: number, to: number): number => { let sum = 0; for (let index = from; index < to; index++) sum += data[index] ** 2; return sum }

describe('延迟与回声', () => {
  it('回声：延迟时间处出现回声量大小的精确副本，之后每次按反馈与音色低通衰减；原声不变；两次回声之间是静音', async () => {
    const input = impulse(RATE * 2)
    const [left] = (await run([effect('echo')], stereo(input))).output
    const delay = RATE / 4
    expect(left[0]).toBe(1)
    expect(left[delay]).toBeCloseTo(.3, 7)
    expect(peak(left, 1, delay)).toBe(0); expect(peak(left, delay + 1, 2 * delay)).toBeLessThan(1e-12)
    const second = energy(left, 2 * delay, 3 * delay); const third = energy(left, 3 * delay, 4 * delay)
    expect(second).toBeGreaterThan(0); expect(second).toBeLessThan((.3 * .35) ** 2); expect(third).toBeLessThan(second * .35 ** 2)
    // 反馈 0：只有一次回声。
    const once = (await run([effect('echo', { feedback: 0 })], stereo(input))).output[0]
    expect(once[delay]).toBeCloseTo(.3, 7); expect(peak(once, delay + 1)).toBe(0)
    // 音色越低，第二次回声的高频越少、能量越小。
    const dark = (await run([effect('echo', { tone: 1000 })], stereo(input))).output[0]
    expect(energy(dark, 2 * delay, 3 * delay)).toBeLessThan(second)
  })
  it('回声：左右交替时回声在左、右声道轮流出现；单声道素材照常回声', async () => {
    const [left, right] = (await run([effect('echo', { ping_pong: true, feedback: 50 })], [impulse(RATE * 2), new Float32Array(RATE * 2)])).output
    const delay = RATE / 4
    expect(left[delay]).toBeCloseTo(.15, 7); expect(right[delay]).toBe(0)
    expect(energy(right, 2 * delay, 3 * delay)).toBeGreaterThan(0); expect(energy(left, 2 * delay, 3 * delay)).toBe(0)
    expect(energy(left, 3 * delay, 4 * delay)).toBeGreaterThan(0); expect(energy(right, 3 * delay, 4 * delay)).toBe(0)
    const mono = (await run([effect('echo', { ping_pong: true })], [impulse(RATE)])).output[0]
    expect(mono[delay]).toBeCloseTo(.3, 7)
  })
  it('回声：拖动延迟时间时滑向新值（不跳读指针、不爆音），停下后回到精确的整样本延迟', async () => {
    const chain = new AudioEffectChain(RATE, 2); await chain.sync([effect('echo', { feedback: 0, mix: 100 })])
    const tone = sine(220, .3, RATE); const block = stereo(tone)
    chain.process(block, RATE)
    expect(await chain.sync([effect('echo', { delay: 300, feedback: 0, mix: 100 })])).toBe(false)
    const next = stereo(sine(220, .3, RATE * 2, 2 * Math.PI * 220))
    chain.process(next, RATE * 2)
    let jump = 0
    for (let index = 1; index < 4800; index++) jump = Math.max(jump, Math.abs(next[0][index] - next[0][index - 1]))
    expect(jump).toBeLessThan(.06)
    // 1 秒后滑行结束：输出 = 原声 + 300 毫秒前的原声。
    const source = (index: number): number => .3 * Math.sin(2 * Math.PI * 220 * (RATE + index) / RATE)
    expectSamples(next[0].subarray(RATE), index => source(RATE + index) + source(RATE + index - RATE * .3), 5)
    chain.dispose()
  })
  it('延迟：全 0 时逐样本原样；左右可不同、按整样本精确延迟；混合量按比例混入原声；单声道用左声道延迟', async () => {
    const input = stereo(noise(RATE, .3, 3), noise(RATE, .3, 5))
    const neutral = (await run([effect('delay')], input)).output
    expectSamples(neutral[0], input[0]); expectSamples(neutral[1], input[1])
    const shifted = (await run([effect('delay', { left_delay: 10, right_delay: 0.5 })], input)).output
    expectSamples(shifted[0], index => index < 480 ? 0 : input[0][index - 480]); expectSamples(shifted[1], index => index < 24 ? 0 : input[1][index - 24])
    const half = (await run([effect('delay', { left_delay: 1, mix: 50 })], input)).output
    expectSamples(half[0], index => input[0][index] * .5 + (index < 48 ? 0 : input[0][index - 48]) * .5, 6)
    expectSamples(half[1], input[1])
    const mono = (await run([effect('delay', { left_delay: 2, right_delay: 5 })], [input[0]])).output[0]
    expectSamples(mono, index => index < 96 ? 0 : input[0][index - 96])
  })
})
