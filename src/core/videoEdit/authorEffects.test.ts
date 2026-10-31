import { describe, expect, it } from 'vitest'
import { authorEffectsFingerprint, resolveAuthorEffects } from './authorEffects'
import { glow, blur, look } from '@/features/videoEdit/authorLibraries/effects'
import type { VideoEditEffectPreset } from './effectPresets'
import { videoEditEffectsRegistry } from './effectsRegistry'
import { blurAmountForSigma, blurBleed, blurZoomRange } from './blur'

describe('作者图层效果解析', () => {
  it('模糊四种方式是同一个效果，图层与片段目录都能找到', () => {
    for (const mode of ['uniform', 'directional', 'radial', 'lens'] as const) expect(resolveAuthorEffects([blur({ mode })])[0]).toMatchObject({ id: 'blur', params: { mode } })
    expect(videoEditEffectsRegistry().some(effect => effect.builtinId === 'blur')).toBe(true)
  })
  it('旧版作者库产出的旧模糊 ID 按存档迁移的同一换算转成模糊', () => {
    expect(resolveAuthorEffects([{ id: 'gaussian_blur', params: { sigma_fraction_height: 0.009, edge_mode: 'transparent' } }])[0]).toMatchObject({ id: 'blur', params: { mode: 'uniform', amount: expect.closeTo(blurAmountForSigma(0.009), 2), repeat_edges: false } })
    expect(resolveAuthorEffects([{ id: 'lens_blur', params: { radius_fraction_height: 0.02 } }])[0]).toMatchObject({ id: 'blur', params: { mode: 'lens', amount: expect.closeTo(blurAmountForSigma(0.01), 2) } })
    expect(resolveAuthorEffects([{ id: 'directional_blur', params: { direction: 30 } }])[0].params).toMatchObject({ mode: 'directional', angle: 30 })
  })
  it('放射模糊的外扩覆盖多道径向取样的反向映射，包含角落中心和最大模糊度', () => {
    const ref = { referenceSize: { width: 1000, height: 500 }, contentBounds: { x: 0, y: 0, width: 800, height: 100 }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
    for (const amount of [0, 20, 50, 100, 200]) for (const center of [0, 50, 100]) {
      const bleed = blurBleed({ mode: 'radial', amount, center_x: center, center_y: center }, ref) * 500
      const range = blurZoomRange(amount)
      if (range * 500 < 1) { expect(bleed).toBe(0); continue }
      // 每道最多缩到 1 − 15/16 × 本道范围；道数越多累计越小，取 4 道作上界。
      const shrink = [1, 2, 3, 4].reduce((product, index) => product * (1 - range * 15 / 16 ** index), 1)
      const reach = 800 * Math.max(center / 100, 1 - center / 100) * (1 / shrink - 1)
      expect(bleed).toBeGreaterThanOrEqual(reach)
    }
  })
  it('补默认值不修改作者对象，顺序和值控制指纹，动态非法值不截断', () => {
    const descriptor = glow({ strength: 20 })
    const first = resolveAuthorEffects([descriptor])
    expect(descriptor.params).toEqual({ strength: 20 })
    expect(authorEffectsFingerprint(first)).toBe(authorEffectsFingerprint(resolveAuthorEffects([{ id: 'glow', params: { ...first[0].params } }])))
    expect(authorEffectsFingerprint(resolveAuthorEffects([descriptor, blur()]))).not.toBe(authorEffectsFingerprint(resolveAuthorEffects([blur(), descriptor])))
    for (const value of [NaN, Infinity, null, -1, 101]) expect(() => resolveAuthorEffects([{ id: 'glow', params: { strength: value } }], {}, 0, 'title')).toThrow(/title.effects\[0\].*strength/)
    for (const value of [undefined, null, Promise.resolve([]), {}]) expect(() => resolveAuthorEffects(value)).toThrow(/同步返回/)
    expect(() => resolveAuthorEffects([{ id: 'glow', params: { unknown: 1 } }])).toThrow(/unknown/)
    expect(() => resolveAuthorEffects([{ id: 'crop' }])).toThrow(/片段效果链/)
  })
  it('全局 look 按快照隔离、精确匹配和曲线展开，拒绝缺失、歧义、蒙版和旋钮', () => {
    const preset: VideoEditEffectPreset = { id: 'a', name: '柔光', media: 'video', effects: [{ id: 'g', name: '发光', enabled: true, amount: .4, builtin: { id: 'glow', params: { strength: 20 }, curves: { strength: [{ time: 0, value: 20, interpolation: 'linear' }, { time: 10, value: 80, interpolation: 'linear' }] } } }] }
    const environment = { presets: [preset] }
    const first = resolveAuthorEffects([look('柔光')], environment, 5)
    expect(first[0]).toMatchObject({ amount: .4, params: { strength: 50 }, source: 'look' })
    expect(() => resolveAuthorEffects([look('柔光')], {})).toThrow(/找不到/)
    expect(() => resolveAuthorEffects([look('柔光')], { presets: [preset, { ...preset, id: 'b' }] })).toThrow(/重名/)
    expect(() => look('柔光', { amount: 1 } as never)).toThrow(/旋钮/)
    expect(authorEffectsFingerprint(first, { presets: [preset, { ...preset, name: '未使用', id: 'b' }] })).toBe(authorEffectsFingerprint(first, environment))
    const changed = structuredClone(preset); changed.effects[0].amount = .8
    expect(resolveAuthorEffects([look('柔光')], { presets: [changed] }, 5)[0].amount).toBe(.8)
    expect(first[0].amount).toBe(.4)
    expect(() => resolveAuthorEffects([look(' 柔光')], environment)).toThrow(/找不到/)
    const masked = structuredClone(preset); masked.effects[0].mask = { kind: 'region', regionId: 'region' } as never
    expect(() => resolveAuthorEffects([look('柔光')], { presets: [masked] })).toThrow(/蒙版/)
    const audio = structuredClone(preset); audio.media = 'audio'
    expect(() => resolveAuthorEffects([look('柔光')], { presets: [audio] })).toThrow(/声音/)
    const disabled = structuredClone(preset); disabled.effects[0].enabled = false
    expect(resolveAuthorEffects([look('柔光')], { presets: [disabled] })).toEqual([])
  })
})
