import { describe, expect, it } from 'vitest'
import { authorEffectsFingerprint, resolveAuthorEffects } from './authorEffects'
import { glow, blur, look } from '@/features/videoEdit/authorLibraries/effects'
import type { VideoEditEffectPreset } from './effectPresets'
import { videoEditEffectsRegistry } from './effectsRegistry'
import { layerEffectBleed } from './layerEffectGeometry'

describe('作者图层效果解析', () => {
  it('镜头虚化只在作者图层可发现，片段效果目录不暴露不可用的入口', () => {
    expect(resolveAuthorEffects([blur({ mode: 'lens' })])[0].id).toBe('lens_blur')
    expect(videoEditEffectsRegistry().some(effect => effect.builtinId === 'lens_blur')).toBe(false)
    expect(videoEditEffectsRegistry().some(effect => effect.builtinId === 'gaussian_blur')).toBe(true)
  })
  it('缩放模糊的外扩覆盖两次径向取样的反向映射，包含角落中心和最大强度', () => {
    const ref = { referenceSize: { width: 1000, height: 500 }, contentBounds: { x: 0, y: 0, width: 800, height: 100 }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
    for (const strength of [0, 20, 50, 100]) for (const center of [0, 50, 100]) {
      const bleed = layerEffectBleed('zoom_blur', { strength, center_x: center, center_y: center }, ref) * 500
      const range = strength / 100 * .2
      const reach = 800 * Math.max(center / 100, 1 - center / 100) * (1 / ((1 - range) * (1 - range / 16)) - 1)
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
