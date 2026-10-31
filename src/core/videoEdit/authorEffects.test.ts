import { videoEditEffectPresetSchema } from './effectPresets'
import { videoEditStyleSchema } from './styles/styleSchemas'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, videoEditNestedComposition } from './document'
import { describe, expect, it, vi } from 'vitest'
import { authorEffectEnvironmentForClip, authorEffectEnvironmentForStyle, authorEffectsFingerprint, resolveAuthorEffects } from './authorEffects'
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
    expect(authorEffectsFingerprint(first, {}, 0)).toBe(authorEffectsFingerprint(resolveAuthorEffects([{ id: 'glow', params: { ...first[0].params } }]), {}, 0))
    expect(authorEffectsFingerprint(resolveAuthorEffects([descriptor, blur()]), {}, 0)).not.toBe(authorEffectsFingerprint(resolveAuthorEffects([blur(), descriptor]), {}, 0))
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
    expect(() => resolveAuthorEffects([look('柔光', { amount: 1 })], environment)).toThrow(/旋钮/)
    expect(authorEffectsFingerprint(first, { presets: [preset, { ...preset, name: '未使用', id: 'b' }] }, 0)).toBe(authorEffectsFingerprint(first, environment, 0))
    const changed = structuredClone(preset); changed.effects[0].amount = .8
    expect(resolveAuthorEffects([look('柔光')], { presets: [changed] }, 5)[0].amount).toBe(.8)
    expect(first[0].amount).toBe(.4)
    expect(() => resolveAuthorEffects([look(' 柔光')], environment)).toThrow(/找不到/)
    const masked = structuredClone(preset); masked.effects[0].mask = { regionId: 'face', invert: false, feather: 0, expand: 0 }
    expect(() => resolveAuthorEffects([look('柔光')], { presets: [masked] })).toThrow(/蒙版/)
    const audio = structuredClone(preset); audio.media = 'audio'
    expect(() => resolveAuthorEffects([look('柔光')], { presets: [audio] })).toThrow(/声音/)
    const disabled = structuredClone(preset); disabled.effects[0].enabled = false
    expect(resolveAuthorEffects([look('柔光')], { presets: [disabled] })).toEqual([])
  })
})

it('look 按风格件快照复用结构，动画旋钮与曲线逐帧求值，换快照读取新内容', () => {
  const preset = videoEditEffectPresetSchema.parse({ id: 'cached', name: '动画柔光', media: 'video', effects: [{ id: 'light', name: '发光', enabled: true, amount: 1, builtin: { id: 'glow', params: { strength: 10 }, curves: { strength: [{ time: 0, value: 10, interpolation: 'linear' }, { time: 10, value: 50, interpolation: 'linear' }] } } }] })
  const clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    expect(resolveAuthorEffects([look(preset.name)], { presets: [preset] }, 0)[0].params.strength).toBe(10)
    const initial = clone.mock.calls.length
    expect(resolveAuthorEffects([look(preset.name)], { presets: [preset] }, 10)[0].params.strength).toBe(50)
    expect(clone.mock.calls.length).toBe(initial)
    const styles = [{ id: 'bound-style', effectPresets: [preset] }]
    for (const frame of [0, 5, 10]) resolveAuthorEffects([look(preset.name)], authorEffectEnvironmentForStyle({}, styles, 'bound-style'), frame)
    expect(clone.mock.calls.length).toBe(initial)
    const revised = structuredClone(preset); revised.effects[0].amount = .3
    expect(resolveAuthorEffects([look(preset.name)], { presets: [revised] }, 10)[0].amount).toBe(.3)
    const scoped = authorEffectEnvironmentForStyle({ presets: [preset] }, [{ id: 'bound', name: '工程口味', effectPresets: [] }], 'bound')
    expect(() => resolveAuthorEffects([look('缺失')], scoped)).toThrow(/工程口味.*动画柔光.*video_edit.project_style.effect_presets.*bind_video_edit_style/)
    expect(() => resolveAuthorEffects([{ id: 'look', params: { name: preset.name }, surprise: 2 }], scoped)).toThrow(/surprise/)
  } finally { clone.mockRestore() }
})

it('连续旋钮变化不重新复制或校验结构，原型同名旋钮使用声明的默认值', () => {
  const preset = videoEditEffectPresetSchema.parse({ id: 'animated', name: '动画', media: 'video', effects: [{ id: 'g', name: '发光', enabled: true, amount: 1, builtin: { id: 'glow', params: {} } }], knobs: [{ key: 'constructor', name: '强度', min: 0, max: 100, default: 30, mappings: [{ effectId: 'g', parameter: 'strength', points: [{ input: 0, output: 0 }, { input: 100, output: 100 }] }] }] })
  expect(preset.effects[0].builtin!.params.strength).toBe(30)
  expect(resolveAuthorEffects([look(preset.name)], { presets: [preset] })[0].params.strength).toBe(30)
  const clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    for (let value = 0; value <= 100; value++) expect(resolveAuthorEffects([look(preset.name, { constructor: value })], { presets: [preset] })[0].params.strength).toBeCloseTo(value, 12)
    expect(clone).not.toHaveBeenCalled()
  } finally { clone.mockRestore() }
})

it('风格件线性与分段旋钮按实例映射，覆盖曲线且不污染原件；风格同名优先，嵌套独立选择', () => {
  const preset = videoEditEffectPresetSchema.parse({ id: 'piece', name: '柔和', media: 'video', effects: [{ id: 'blur-a', name: '模糊', enabled: true, amount: .4, builtin: { id: 'blur', params: { amount: .01 }, curves: { amount: [{ time: 0, value: .02, interpolation: 'linear' }] } } }, { id: 'blur-b', name: '模糊', enabled: true, amount: .8, builtin: { id: 'blur', params: {} } }], knobs: [{ key: 'soft', name: '柔和度', min: 0, max: 100, default: 25, mappings: [{ effectId: 'blur-a', parameter: 'amount', points: [{ input: 0, output: 0 }, { input: 50, output: .01 }, { input: 100, output: .03 }] }, { effectId: 'blur-b', parameter: 'amount', points: [{ input: 0, output: 0 }, { input: 100, output: .04 }] }] }] })
  const original = structuredClone(preset)
  const mapped = resolveAuthorEffects([look('柔和', { soft: 75 })], { presets: [preset] }, 20)
  expect(mapped[0].params.amount).toBeCloseTo(.02, 12); expect(mapped[1].params.amount).toBeCloseTo(.03, 12)
  expect(mapped.map(effect => effect.amount)).toEqual([.4, .8])
  expect(resolveAuthorEffects([look('柔和')], { presets: [preset] })[0].params.amount).toBe(.005)
  for (const knobs of [{ unknown: 1 }, { soft: 101 }, { soft: NaN }] as Record<string, number>[]) expect(() => resolveAuthorEffects([look('柔和', knobs)], { presets: [preset] })).toThrow()
  expect(preset).toEqual(original)
  expect(videoEditEffectPresetSchema.safeParse({ ...preset, knobs: [{ ...preset.knobs![0], mappings: [{ ...preset.knobs![0].mappings[0], parameter: 'missing' }] }] }).success).toBe(false)
  const document = createVideoEditDocument('风格隔离'), parent = createVideoEditSequence(), child = createVideoEditSequence()
  parent.styleId = 'parent-style'; child.styleId = 'child-style'
  const style = (id: string, amount: number) => videoEditStyleSchema.parse({ id, name: id, description: '', version: 1, contentHash: '', updatedAt: new Date().toISOString(), guide: '', sample: { code: { entry: 'index.js', files: { 'index.js': 'export default { draw() {} }' } } }, effectPresets: [{ ...preset, effects: preset.effects.map(effect => ({ ...effect, amount })) }] })
  const styles = [style(parent.styleId, .2), style(child.styleId, .7)]
  document.sequences = [parent, child]; document.items = [{ id: 'nested', name: '子序列', kind: 'sequence', sequenceId: child.id }]
  const root = { ...videoEditComposition(document, parent.id), styles, authorEffects: authorEffectEnvironmentForStyle({ presets: [preset] }, styles, parent.styleId) }
  expect(resolveAuthorEffects([look('柔和')], root.authorEffects)[0].amount).toBe(.2)
  const nested = videoEditNestedComposition(root, { kind: 'sequence', itemId: 'nested' })!
  expect(resolveAuthorEffects([look('柔和')], nested.authorEffects)[0].amount).toBe(.7)
  expect(resolveAuthorEffects([look('柔和')], authorEffectEnvironmentForStyle(root.authorEffects, styles))[0].amount).toBe(.4)
  const template = { id: 'template', name: '模板', description: '', version: 1, contentHash: '', updatedAt: new Date().toISOString(), origin: null, style: { id: child.styleId, version: 1 }, body: { kind: 'code' as const, definitionId: 'template-code' } }
  const templateDocument = { ...root, templates: [template] }, templateClip = { code: { definitionId: 'template-code', versionId: 'v1', parameters: {} } }
  expect(resolveAuthorEffects([look('柔和')], authorEffectEnvironmentForClip(templateDocument, templateClip))[0].amount).toBe(.7)
  expect(resolveAuthorEffects([look('柔和')], authorEffectEnvironmentForClip(templateDocument, {}))[0].amount).toBe(.2)
  expect(resolveAuthorEffects([look('柔和')], authorEffectEnvironmentForClip({ ...templateDocument, templates: [{ ...template, style: null }] }, templateClip))[0].amount).toBe(.4)
  expect(() => authorEffectEnvironmentForClip({ ...templateDocument, styles: [] }, templateClip)).toThrow(/模板所属风格.*child-style/)
})

it('画面效果只能进调整层或片段链，空间校验包含 look 展开及参数空间', () => {
  expect(() => resolveAuthorEffects([{ id: 'vignette' }])).toThrow('暗角按整幅画面算，请放进调整层 adjust。')
  expect(() => resolveAuthorEffects([{ id: 'film_grain' }])).toThrow('颗粒按整幅画面算，请放进调整层 adjust。')
  expect(resolveAuthorEffects([{ id: 'vignette' }, { id: 'film_grain' }, { id: 'color_grade' }], {}, 0, 'grade', 'frame').map(effect => effect.id)).toEqual(['vignette', 'film_grain', 'color_grade'])
  expect(() => resolveAuthorEffects([{ id: 'crop' }], {}, 0, 'grade', 'frame')).toThrow('片段效果链')
  const preset: VideoEditEffectPreset = { id: 'v', name: '镜头', media: 'video', effects: [{ id: 'v', name: '暗角', enabled: true, amount: 1, builtin: { id: 'vignette', params: {} } }] }
  expect(() => resolveAuthorEffects([look('镜头')], { presets: [preset] })).toThrow('暗角按整幅画面算，请放进调整层 adjust。')
  expect(resolveAuthorEffects([look('镜头')], { presets: [preset] }, 0, 'grade', 'frame')[0]).toMatchObject({ id: 'vignette', source: 'look' })
  for (const descriptor of [[{ id: 'vignette' }], [look('镜头')]]) {
    expect(() => resolveAuthorEffects(descriptor, { presets: [preset] }, 0, 'title', 'layer', 8)).toThrow(/请使用片段效果链.*升级作者接口.*adjust/)
  }
})
