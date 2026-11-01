import { videoEditEffectPresetSchema } from './effectPresets'
import { videoEditStyleSchema } from './styles/styleSchemas'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, videoEditNestedComposition } from './document'
import { describe, expect, it, vi } from 'vitest'
import { applyAuthorElementEffectOverride, authorEffectEnvironmentForClip, authorEffectEnvironmentForStyle, authorEffectsFingerprint, codeElementAddedEffectKeys, resolveAuthorEffects, resolveAuthorElementEffects, validateAuthorElementEffectOverrides, validateCodeElementOverridesWithoutObservation } from './authorEffects'
import { evaluateCodeElementOverride, type EvaluatedCodeElementOverride } from './codeElementOverrides'
import { CODE_AUTHOR_EFFECT_KEYS_MIN_API_VERSION, CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from './codeAuthorVersions'
import { advanceVideoEditClipSource, setVideoEditClipReverse, videoEditClipSourceTimeAt } from './clipSpeed'
import { glow, blur, look, colorGrade } from '@/features/videoEdit/authorLibraries/effects'
import type { VideoEditEffectPreset } from './effectPresets'
import { videoEditEffectsRegistry } from './effectsRegistry'
import { blurAmountForSigma, blurBleed, blurZoomRange } from './blur'
import { normalizeVideoEditBuiltinParams } from './builtinEffects'

it('效果身份按出现顺序生成，同一元素重复报错，新 key 只在新作者接口接受', () => {
  expect(resolveAuthorEffects([glow(), glow(), blur({}, { key: 'soften' })]).map(effect => effect.key)).toEqual(['glow', 'glow#2', 'soften'])
  // 自动 key 让开显式 key，与书写顺序无关；旧接口的风格件名带 #N 也不撞名。
  expect(resolveAuthorEffects([glow(), glow(), blur({}, { key: 'glow#2' })]).map(effect => effect.key)).toEqual(['glow', 'glow#3', 'glow#2'])
  expect(resolveAuthorEffects([glow(), glow({}, { key: 'glow' })]).map(effect => effect.key)).toEqual(['glow#2', 'glow'])
  expect(() => resolveAuthorEffects([glow({}, { key: 'a' }), blur({}, { key: 'a' })])).toThrow(/key.*重复/)
  expect(() => resolveAuthorEffects([glow({}, { key: 'a' })], {}, 0, 'title', 'layer', CODE_AUTHOR_EFFECT_KEYS_MIN_API_VERSION - 1)).toThrow(/key/)
  // 冻结作者库的旧模糊 ID 换算成模糊，身份仍按作者写的 ID。
  expect(resolveAuthorElementEffects([{ id: 'gaussian_blur', params: {} }], undefined).states).toMatchObject([{ key: 'gaussian_blur', id: 'blur' }])
})

it('先叠加覆盖、跳过停用、追加末尾效果；读取钳制并保留 missing，写入拒绝越界与重名', () => {
  const code = [glow({ strength: 10 }, { key: 'light' }), blur({ amount: 20 })]
  const override: EvaluatedCodeElementOverride = { effects: { light: { values: { strength: 400 } }, blur: { enabled: false }, gone: { values: { amount: 3 } } }, addedEffects: [{ key: 'mono', id: 'black_white', params: { amount: 80 } }, { key: 'removed', id: 'removed-effect', params: {} }, { key: 'frame', id: 'vignette', params: {} }] }
  const resolved = resolveAuthorElementEffects(code, override)
  expect(resolved.effects.map(effect => [effect.key, effect.id])).toEqual([['light', 'glow'], ['mono', 'black_white']])
  expect(resolved.effects[0].params.strength).toBe(100)
  expect(resolved.states).toContainEqual(expect.objectContaining({ key: 'light', codeValues: expect.objectContaining({ strength: 10 }), values: expect.objectContaining({ strength: 100 }), overridden: ['strength'] }))
  expect(resolved.states).toContainEqual(expect.objectContaining({ key: 'blur', enabled: false, missing: false }))
  expect(resolved.states.filter(state => state.missing).map(state => state.key)).toEqual(['removed', 'frame', 'gone'])
  expect(() => validateAuthorElementEffectOverrides({ effects: { light: { values: { strength: 400 } } } }, resolved.states, {}, 'layer')).toThrow(/strength/)
  expect(() => validateAuthorElementEffectOverrides({ effects: { gone: { values: { amount: 3 } } } }, resolved.states, {}, 'layer')).toThrow(/没有效果「gone」/)
  expect(() => validateAuthorElementEffectOverrides({ addedEffects: [{ key: 'light', id: 'blur', params: {} }] }, resolved.states, {}, 'layer')).toThrow(/重名/)
  expect(() => validateAuthorElementEffectOverrides({ addedEffects: [{ key: 'v', id: 'vignette', params: {} }] }, resolved.states, {}, 'layer')).toThrow(/调整层/)
  expect(() => validateAuthorElementEffectOverrides({ addedEffects: [{ key: 'v', id: 'vignette', params: {} }] }, [], {}, 'frame')).not.toThrow()
  expect(override.effects!.light.values!.strength).toBe(400)
})

it('跨参数约束按代码值加覆盖整组校验：写入拒绝调色起点大于终点，读取退回代码值、追加项记 missing，不抛错', () => {
  const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
  const code = [colorGrade({ hsl_saturation_end: 80 })]
  const states = resolveAuthorElementEffects(code, undefined).states
  // 逐项看都在范围内，组合起来起点大于终点：只写起点也要和代码给的终点一起校验。
  expect(() => validateAuthorElementEffectOverrides({ effects: { color_grade: { values: { hsl_saturation_start: 90 } } } }, states, {}, 'layer')).toThrow(/不得大于/)
  expect(() => validateAuthorElementEffectOverrides({ effects: { color_grade: { values: { hsl_saturation_start: 50 } } } }, states, {}, 'layer')).not.toThrow()
  expect(() => validateAuthorElementEffectOverrides({ addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 90, hsl_saturation_end: 10 } }] }, states, {}, 'layer')).toThrow(/不得大于/)
  // 关键帧时刻的整组值同样检查。
  const crossing = { hsl_saturation_start: [{ id: 'a', ...time(0), value: 10, interpolation: 'linear' as const }, { id: 'b', ...time(1e6), value: 90, interpolation: 'linear' as const }] }
  expect(() => validateAuthorElementEffectOverrides({ effects: { color_grade: { curves: crossing } } }, states, {}, 'layer')).toThrow(/不得大于/)
  expect(() => validateAuthorElementEffectOverrides({ effects: { color_grade: { values: { hsl_saturation_end: 100 }, curves: crossing } } }, states, {}, 'layer')).not.toThrow()
  // 缓动段在关键帧之间弯折：两端都合法、段中起点越过终点也要拒绝。
  const eased = { hsl_saturation_start: [{ id: 'c', ...time(0), value: 0, interpolation: 'linear' as const }, { id: 'd', ...time(1e6), value: 90, interpolation: 'linear' as const }], hsl_saturation_end: [{ id: 'e', ...time(0), value: 5, interpolation: 'ease' as const }, { id: 'f', ...time(1e6), value: 95, interpolation: 'linear' as const }] }
  expect(() => validateAuthorElementEffectOverrides({ effects: { color_grade: { curves: eased } } }, states, {}, 'layer')).toThrow(/不得大于/)
  // 存档里已有的非法组合：整帧照常解析，代码项退回代码值，追加项跳过并记 missing。
  const read = resolveAuthorElementEffects(code, { effects: { color_grade: { values: { hsl_saturation_start: 90 } } }, addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 90, hsl_saturation_end: 10 } }] })
  expect(read.effects).toHaveLength(1)
  expect(read.effects[0].params).toMatchObject({ hsl_saturation_start: 0, hsl_saturation_end: 80 })
  expect(read.states).toEqual([expect.objectContaining({ key: 'color_grade', overridden: [], values: expect.objectContaining({ hsl_saturation_start: 0 }) }), expect.objectContaining({ key: 'grade', added: true, missing: true })])
})

it('源码后来用了追加项的 key：追加项换成不冲突的 key，代码那一项保留原 key', () => {
  const resolved = resolveAuthorElementEffects([glow({}, { key: 'soft' })], { addedEffects: [{ key: 'blur+1', id: 'glow', params: {} }, { key: 'soft', id: 'blur', params: { amount: 10 } }] })
  expect(resolved.states.map(state => [state.key, state.added])).toEqual([['soft', false], ['blur+1', true], ['blur+2', true]])
  expect(resolved.effects.map(effect => [effect.key, effect.id])).toEqual([['soft', 'glow'], ['blur+1', 'glow'], ['blur+2', 'blur']])
  expect(codeElementAddedEffectKeys(new Set(['glow']), [{ key: 'glow', id: 'glow' }, { key: 'glow+1', id: 'blur' }])).toEqual(['glow+2', 'glow+1'])
})

it('素材项与代码资产没有观察：追加效果整组严格校验，只查改动的项，代码效果 key 留到放进片段后校验', () => {
  const api = CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION
  const bad = { title: { addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 90, hsl_saturation_end: 10 } }] } }
  expect(() => validateCodeElementOverridesWithoutObservation(bad, undefined, {}, api)).toThrow(/元素「title」.*不得大于/)
  expect(() => validateCodeElementOverridesWithoutObservation(bad, bad, {}, api)).not.toThrow()
  expect(() => validateCodeElementOverridesWithoutObservation({ title: { addedEffects: [{ key: 'g', id: 'glow', params: { strength: 400 } }] } }, undefined, {}, api)).toThrow(/strength/)
  expect(() => validateCodeElementOverridesWithoutObservation({ title: { addedEffects: [{ key: 'l', id: 'color_grade', params: { look_lut: 'missing-lut' } }] } }, undefined, {}, api)).toThrow(/LUT/)
  // 代码资产不带 LUT、工程里的 LUT 也可能事后删掉：导入与放进时间线不因缺 LUT 拒绝。
  expect(() => validateCodeElementOverridesWithoutObservation({ title: { addedEffects: [{ key: 'l', id: 'color_grade', params: { look_lut: 'missing-lut' } }] } }, undefined, {}, api, false)).not.toThrow()
  // 不知道是不是调整层：整帧效果按调整层可用即可。
  expect(() => validateCodeElementOverridesWithoutObservation({ fx: { addedEffects: [{ key: 'v', id: 'vignette', params: {} }] } }, undefined, {}, api)).not.toThrow()
  expect(() => validateCodeElementOverridesWithoutObservation({ title: { effects: { anything: { values: { strength: 1 } } } } }, undefined, {}, api)).not.toThrow()
  expect(() => validateCodeElementOverridesWithoutObservation({ title: { effects: { anything: { enabled: false } } } }, undefined, {}, api - 1)).toThrow(/升级/)
})

it('图层效果之前的作者接口不叠加元素效果覆盖，写入点名升级', () => {
  const override: EvaluatedCodeElementOverride = { addedEffects: [{ key: 'mono', id: 'black_white', params: {} }] }
  expect(resolveAuthorElementEffects([], override, {}, 0, 'title', 'layer', CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION - 1).effects).toEqual([])
  expect(() => validateAuthorElementEffectOverrides(override, [], {}, 'layer', CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION - 1)).toThrow(/升级/)
})

it('look 在宿主是一项，只能覆盖旋钮，关闭整项也关闭其全部成员', () => {
  const preset: VideoEditEffectPreset = { id: 'p', name: '柔光', media: 'video', knobs: [{ key: 'light', name: '光', min: 0, max: 100, default: 20, mappings: [{ effectId: 'g', parameter: 'strength', points: [{ input: 0, output: 0 }, { input: 100, output: 100 }] }] }], effects: [{ id: 'g', name: '光', enabled: true, amount: 1, builtin: { id: 'glow', params: {} } }, { id: 'b', name: '模糊', enabled: true, amount: 1, builtin: { id: 'blur', params: {} } }] }
  const environment = { presets: [preset] }, code = [look('柔光')]
  const on = resolveAuthorElementEffects(code, { effects: { 'look:柔光': { values: { light: 60 } } } }, environment)
  expect(on.states).toEqual([expect.objectContaining({ key: 'look:柔光', id: 'look', name: '柔光', codeValues: { light: 20 }, values: { light: 60 }, overridden: ['light'] })])
  expect(on.effects.map(effect => effect.key)).toEqual(['look:柔光', 'look:柔光'])
  expect(on.effects[0].params.strength).toBe(60)
  expect(() => validateAuthorElementEffectOverrides({ effects: { 'look:柔光': { values: { strength: 60 } } } }, on.states, environment, 'layer')).toThrow(/旋钮/)
  expect(resolveAuthorElementEffects(code, { effects: { 'look:柔光': { enabled: false } } }, environment).effects).toEqual([])
  // 界面在渲染完成前只凭观察到的代码值叠加，结果与渲染一致。
  expect(applyAuthorElementEffectOverride(on.states.map(({ key, id, name, codeValues }) => ({ key, id, name, codeValues })), { effects: { 'look:柔光': { values: { light: 60 } } } }, environment)).toEqual(on)
})

it('效果曲线固定在素材时刻，修剪、两倍速度和倒放不移动动画', () => {
  const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
  const override = { effects: { glow: { curves: { strength: [{ id: 'a', ...time(0), value: 0, interpolation: 'linear' as const }, { id: 'b', ...time(4e6), value: 100, interpolation: 'linear' as const }] } } }, addedEffects: [{ key: 'extra', id: 'blur', params: {}, curves: { amount: [{ id: 'c', ...time(0), value: 0, interpolation: 'linear' as const }, { id: 'd', ...time(4e6), value: 80, interpolation: 'linear' as const }] } }] }
  const rate = { numerator: 30, denominator: 1 }, clip = { start: 20, duration: 60, ...time(1e6), speed: { numerator: 2, denominator: 1 } }
  const trimmed = { ...clip, start: 35, duration: 45, ...advanceVideoEditClipSource(clip, 15, rate) }
  const reversed = setVideoEditClipReverse(clip, true, rate)
  for (const [candidate, frame] of [[clip, 15], [trimmed, 0], [reversed, 44]] as const) {
    const sourceTime = videoEditClipSourceTimeAt(candidate, frame, rate)
    expect(sourceTime.sourceInUs).toBe(2e6)
    const result = resolveAuthorElementEffects([glow()], evaluateCodeElementOverride(override, sourceTime))
    expect(result.effects[0].params.strength).toBe(50); expect(result.effects[1].params.amount).toBe(40)
  }
})

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

it('片段上存下的描边（含片段专用的轮廓来源）可作风格件用在图层上：轮廓来源不论取值都跳过', () => {
  const preset: VideoEditEffectPreset = { id: 'white-edge', name: '白边', media: 'video', effects: [{ id: 'edge', name: '描边', enabled: true, amount: 1, builtin: { id: 'stroke', params: normalizeVideoEditBuiltinParams('stroke', { width: 30 }) } }] }
  expect(preset.effects[0].builtin!.params.contour).toBe('alpha')
  expect(resolveAuthorEffects([look('白边')], { presets: [preset] })[0].params).not.toHaveProperty('contour')
  const subject = structuredClone(preset); subject.effects[0].builtin!.params.contour = 'subject'
  expect(resolveAuthorEffects([look('白边')], { presets: [subject] })[0].params).not.toHaveProperty('contour')
})
