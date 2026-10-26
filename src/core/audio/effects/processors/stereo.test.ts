import { describe, it } from 'vitest'
import { effect, expectSamples, noise, RATE, run, sine } from './audioEffects.testSupport'

describe('立体声与声道', () => {
  it('立体声扩展：宽度 100、中置 0 时逐样本原样；宽度 0 变单声道；宽度 200 侧声道加倍；中置只改左右共有的部分；单声道素材原样', async () => {
    const left = sine(220, .3, RATE / 2); const right = sine(330, .2, RATE / 2)
    const input = [Float32Array.from(left), Float32Array.from(right)]
    const neutral = (await run([effect('stereo_width')], input)).output
    expectSamples(neutral[0], left); expectSamples(neutral[1], right)
    const mono = (await run([effect('stereo_width', { width: 0 })], input)).output
    expectSamples(mono[0], index => (left[index] + right[index]) / 2, 6); expectSamples(mono[1], mono[0])
    const wide = (await run([effect('stereo_width', { width: 200 })], input)).output
    expectSamples(wide[0], index => (left[index] + right[index]) / 2 + (left[index] - right[index]), 6)
    expectSamples(wide[1], index => (left[index] + right[index]) / 2 - (left[index] - right[index]), 6)
    // 中置 +6.02 dB：左右相同（纯中声道）的声音变成两倍，左右相反（纯侧声道）的声音不变。
    const center = (await run([effect('stereo_width', { center: 20 * Math.log10(2) })], [Float32Array.from(left), Float32Array.from(left, value => -value)])).output
    expectSamples(center[0], left, 6)
    const shared = (await run([effect('stereo_width', { center: 20 * Math.log10(2) })], [Float32Array.from(left), Float32Array.from(left)])).output
    expectSamples(shared[0], index => left[index] * 2, 6)
    const single = (await run([effect('stereo_width', { width: 200, center: 6 })], [Float32Array.from(left)])).output[0]
    expectSamples(single, left)
  })
  it('反相：选定声道逐样本取反，其余声道不变；单声道素材反相唯一的声道；效果强度 50% 与原声抵消成静音', async () => {
    const left = noise(RATE / 4, .5, 3); const right = noise(RATE / 4, .5, 4)
    const both = (await run([effect('polarity_invert')], [Float32Array.from(left), Float32Array.from(right)])).output
    expectSamples(both[0], index => -left[index]); expectSamples(both[1], index => -right[index])
    const onlyLeft = (await run([effect('polarity_invert', { channels: 'left' })], [Float32Array.from(left), Float32Array.from(right)])).output
    expectSamples(onlyLeft[0], index => -left[index]); expectSamples(onlyLeft[1], right)
    const onlyRight = (await run([effect('polarity_invert', { channels: 'right' })], [Float32Array.from(left), Float32Array.from(right)])).output
    expectSamples(onlyRight[0], left); expectSamples(onlyRight[1], index => -right[index])
    const mono = (await run([effect('polarity_invert', { channels: 'right' })], [Float32Array.from(left)])).output[0]
    expectSamples(mono, index => -left[index])
    const cancelled = (await run([effect('polarity_invert', {}, .5)], [Float32Array.from(left)])).output[0]
    expectSamples(cancelled, () => 0, 9)
  })
})
