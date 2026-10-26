import { describe, expect, it } from 'vitest'
import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { cascadeResponse, effect, expectSamples, noise, RATE, run, sine, steadyGain, stereo } from './audioEffects.testSupport'
import { dehumDesign, dehumNotch, eqBandQ, eqBandsDesign, graphicEqDesign, notchDesign, notchQ } from './filters'

/** 频率 `frequency` 的正弦（2 秒）经过效果后的稳态增益（从第 1 秒起量），dB。 */
async function gainAt(builtinId: string, params: Record<string, unknown>, frequency: number): Promise<number> {
  const tone = sine(frequency, .3, RATE * 2)
  return steadyGain((await run([effect(builtinId, params)], stereo(tone))).output[0], tone, RATE)
}
const designOf = (builtinId: string, params: Record<string, unknown>) => resolveVideoEditBuiltinParams({ id: builtinId, params: effect(builtinId, params).builtin.params })

describe('滤波与均衡类效果', () => {
  it('图形均衡器：全部为 0 时逐样本原样（不经滤波）；单段提升只在该频段附近，实测频响与理论一致；输出增益整体缩放', async () => {
    const input = stereo(noise(RATE, .3), sine(440, .3, RATE))
    const neutral = (await run([effect('graphic_eq')], input)).output
    expectSamples(neutral[0], input[0]); expectSamples(neutral[1], input[1])
    const params = { band_1k: 6, band_63: -6 }
    const specs = graphicEqDesign(designOf('graphic_eq', params))
    for (const frequency of [63, 250, 1000, 4000]) expect(await gainAt('graphic_eq', params, frequency)).toBeCloseTo(cascadeResponse(specs, frequency), 1)
    expect(await gainAt('graphic_eq', params, 1000)).toBeGreaterThan(5.8); expect(await gainAt('graphic_eq', params, 63)).toBeLessThan(-5.8)
    expect(Math.abs(await gainAt('graphic_eq', params, 4000))).toBeLessThan(.5)
    expect(await gainAt('graphic_eq', { output: -6 }, 1000)).toBeCloseTo(-6, 2)
  })
  it('参数均衡器：全部中性时逐样本原样；高通、低通开关生效；峰值段按频率与窄度提升，窄度换算 Q（30 ≈ 1）', async () => {
    const input = stereo(noise(RATE, .3), sine(440, .3, RATE))
    const neutral = (await run([effect('eq_bands')], input)).output
    expectSamples(neutral[0], input[0]); expectSamples(neutral[1], input[1])
    expect(eqBandQ(30)).toBeCloseTo(1, 1); expect(eqBandQ(0)).toBeCloseTo(.3); expect(eqBandQ(100)).toBeCloseTo(8)
    expect(await gainAt('eq_bands', { hp_on: true }, 20)).toBeLessThan(-20)
    expect(Math.abs(await gainAt('eq_bands', { hp_on: true, lp_on: true }, 1000))).toBeLessThan(.1)
    expect(await gainAt('eq_bands', { lp_on: true, lp_frequency: 2000 }, 8000)).toBeLessThan(-20)
    const wide = { band2_gain: 6 }; const narrow = { band2_gain: 6, band2_q: 100 }
    expect(await gainAt('eq_bands', wide, 1000)).toBeCloseTo(6, 1)
    expect(await gainAt('eq_bands', narrow, 1000)).toBeCloseTo(6, 1)
    expect(await gainAt('eq_bands', narrow, 1500)).toBeLessThan((await gainAt('eq_bands', wide, 1500)) - 2)
    const shelves = { low_gain: 6, high_gain: -6, band1_gain: -3, band3_gain: 4 }
    const specs = eqBandsDesign(designOf('eq_bands', shelves))
    for (const frequency of [50, 250, 4000, 15000]) expect(await gainAt('eq_bands', shelves, frequency)).toBeCloseTo(cascadeResponse(specs, frequency), 1)
  })
  it('陷波：中心频率按深度压低，一个倍频程外几乎不变；深度 0 原样；宽度换算 Q（50 ≈ 5.5）', async () => {
    expect(notchQ(0)).toBe(30); expect(notchQ(50)).toBeCloseTo(5.48, 2); expect(notchQ(100)).toBeCloseTo(1)
    expect(await gainAt('notch', {}, 1000)).toBeCloseTo(-30, 0)
    for (const frequency of [500, 2000]) expect(await gainAt('notch', {}, frequency)).toBeGreaterThan(-.2)
    expect(await gainAt('notch', { depth: -60, frequency: 3000 }, 3000)).toBeLessThan(-55)
    const tone = stereo(sine(1000, .3, RATE))
    expectSamples((await run([effect('notch', { depth: 0 })], tone)).output[0], tone[0])
    expect(await gainAt('notch', { width: 100 }, 1500)).toBeCloseTo(cascadeResponse(notchDesign(designOf('notch', { width: 100 })), 1500), 1)
  })
  it('去除嗡嗡声：50 Hz 及倍频压低 35 dB 以上，谐波数之外与人声频段不受影响；60 Hz 电网可选；30 Hz 以下的次低频被切掉', async () => {
    expect(dehumNotch(80)).toEqual({ depth: -48, q: 14 })
    for (const frequency of [50, 100, 150, 250]) expect(await gainAt('dehum', {}, frequency)).toBeLessThan(-35)
    expect(Math.abs(await gainAt('dehum', {}, 1000))).toBeLessThan(.2)
    expect(await gainAt('dehum', {}, 330)).toBeGreaterThan(-1)
    expect(await gainAt('dehum', {}, 10)).toBeLessThan(-30)
    expect(await gainAt('dehum', { mains: '60' }, 60)).toBeLessThan(-35); expect(await gainAt('dehum', { mains: '60' }, 120)).toBeLessThan(-35)
    expect(await gainAt('dehum', { mains: '60' }, 50)).toBeGreaterThan(-2)
    // 谐波数改变不改变段数（多出的谐波为直通段），拖动参数不清状态。
    expect(dehumDesign(designOf('dehum', { harmonics: 1 }))).toHaveLength(dehumDesign(designOf('dehum', { harmonics: 10 })).length)
    expect(await gainAt('dehum', { harmonics: 10 }, 500)).toBeLessThan(-35)
    // 强度 0：只剩 30 Hz 高通，50 Hz 几乎不变。
    expect(await gainAt('dehum', { amount: 0 }, 50)).toBeGreaterThan(-.5)
  })
})
