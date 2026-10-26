import { describe, expect, it } from 'vitest'
import { cascadeResponse, db, effect, expectSamples, noise, peak, RATE, rms, run, sine, steadyGain, stereo, toneAmplitude } from './audioEffects.testSupport'
import { vocalEnhancerDesign } from './special'

describe('特殊效果', () => {
  it('扭曲：加入谐波（柔和、硬削波只有奇次，电子管带偶次）；驱动加大只增加失真、不会越来越响；混合量 0 原样', async () => {
    const tone = sine(200, .5, RATE)
    const harmonics = async (params: Record<string, unknown>) => {
      const output = (await run([effect('distortion', params)], stereo(tone))).output[0]
      const fundamental = toneAmplitude(output, 200, RATE / 2, RATE / 2)
      return { second: db(toneAmplitude(output, 400, RATE / 2, RATE / 2) / fundamental), third: db(toneAmplitude(output, 600, RATE / 2, RATE / 2) / fundamental), output }
    }
    const soft = await harmonics({}); const hard = await harmonics({ character: 'hard' }); const tube = await harmonics({ character: 'tube' })
    expect(soft.third).toBeGreaterThan(-30); expect(soft.second).toBeLessThan(-80)
    expect(hard.third).toBeGreaterThan(-20); expect(hard.second).toBeLessThan(-80)
    expect(tube.second).toBeGreaterThan(-40)
    for (const result of [soft, hard, tube]) expect(peak(result.output)).toBeLessThan(1.2)
    const gentle = (await run([effect('distortion', { drive: 6 })], stereo(tone))).output[0]
    const heavy = (await run([effect('distortion', { drive: 40 })], stereo(tone))).output[0]
    expect(db(rms(heavy, RATE / 2) / rms(gentle, RATE / 2))).toBeLessThan(6)
    expectSamples((await run([effect('distortion', { mix: 0 })], stereo(tone))).output[0], tone)
  })
  it('人声增强：强度 0 原样；实测频响与固定曲线乘强度一致（去浑浊、提升存在感、柔和高频）', async () => {
    const input = stereo(noise(RATE, .3), sine(440, .3, RATE))
    expectSamples((await run([effect('vocal_enhancer', { amount: 0 })], input)).output[0], input[0])
    for (const voice of ['low', 'high', 'music']) {
      const params = effect('vocal_enhancer', { voice }).builtin.params
      const specs = vocalEnhancerDesign(params)
      for (const frequency of [220, 3000, 12000]) {
        const tone = sine(frequency, .3, RATE)
        expect(steadyGain((await run([effect('vocal_enhancer', { voice })], stereo(tone))).output[0], tone)).toBeCloseTo(cascadeResponse(specs, frequency), 1)
      }
    }
    const lowSpecs = vocalEnhancerDesign(effect('vocal_enhancer').builtin.params)
    expect(cascadeResponse(lowSpecs, 220)).toBeLessThan(-2.5); expect(cascadeResponse(lowSpecs, 3200)).toBeGreaterThan(2); expect(cascadeResponse(lowSpecs, 14000)).toBeLessThan(-.8)
  })
})
