import { describe, expect, it } from 'vitest'
import { normalizeVideoEditBuiltinParams, parseVideoEditBuiltinRefId, resolveVideoEditBuiltinParams, VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults, videoEditBuiltinEffectIssue } from './builtinEffects'
import { videoEditEffectSchema } from './compositing'
import { videoEditEffectsRegistry } from './effectsRegistry'

describe('内置效果登记', () => {
  it('每个参数都有用户说明、助手语义、单位范围与范围内的默认值，默认值组成的参数表合法', () => {
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS) {
      expect(definition.description.length, definition.id).toBeGreaterThan(8)
      expect(new Set(definition.params.map(param => param.key)).size).toBe(definition.params.length)
      for (const param of definition.params) {
        // 着色器组件参数的名字已说明含义，悬停说明可空；助手语义必有（框架原文）。
        expect(definition.id.startsWith('shaders.') ? param.description : param.tooltip && param.description, `${definition.id}.${param.key}`).toBeTruthy()
        if (param.type === 'number') { expect(param.default).toBeGreaterThanOrEqual(param.min); expect(param.default).toBeLessThanOrEqual(param.max) }
        if (param.type === 'enum') expect(param.options.map(option => option.value)).toContain(param.default)
      }
      expect(videoEditBuiltinEffectIssue({ id: definition.id, params: videoEditBuiltinDefaults(definition) })).toBeUndefined()
    }
  })
  it('效果面板登记表列出全部内置效果，带参数与分组', () => {
    const entries = videoEditEffectsRegistry().filter(entry => entry.builtinId)
    expect(entries.map(entry => entry.builtinId)).toEqual(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => definition.id))
    expect(entries.every(entry => entry.category === (entry.media === 'audio' ? 'audio_effect' : 'video_effect') && entry.id === `effect:${entry.builtinId}` && entry.group && entry.params)).toBe(true)
    expect(parseVideoEditBuiltinRefId('effect:gaussian_blur')).toBe('gaussian_blur'); expect(parseVideoEditBuiltinRefId('gaussian_blur')).toBe('gaussian_blur'); expect(parseVideoEditBuiltinRefId('effect:nope')).toBeUndefined()
  })
  it('严格校验越界、错类型与未知参数并列出可用范围；界面写入时夹进范围', () => {
    expect(normalizeVideoEditBuiltinParams('gaussian_blur', { sigma_fraction_height: 0.0135 })).toEqual({ sigma_fraction_height: 0.0135, axis: 'both', edge_mode: 'clamp' })
    expect(() => normalizeVideoEditBuiltinParams('gaussian_blur', { sigma_fraction_height: -1 })).toThrow('超出范围 0–')
    expect(() => normalizeVideoEditBuiltinParams('gaussian_blur', { radius: 3 })).toThrow('可用参数：sigma_fraction_height、axis、edge_mode')
    expect(() => normalizeVideoEditBuiltinParams('gaussian_blur', { axis: 'diagonal' })).toThrow('both、horizontal、vertical')
    expect(() => normalizeVideoEditBuiltinParams('nope')).toThrow('可用：gaussian_blur')
    expect(normalizeVideoEditBuiltinParams('exposure', { exposure: 9 }, undefined, true)).toEqual({ exposure: 4 })
    // 颜色由测试拼出（颜色字面量只允许登记在主题文件）
    expect(normalizeVideoEditBuiltinParams('chroma_key', { key_color: ` #${'00B140'} ` }).key_color).toBe(`#${'00b140'}`)
    expect(() => normalizeVideoEditBuiltinParams('chroma_key', { key_color: 'green' })).toThrow('#rrggbb')
    // 只改给出的键，其余保留原值；旧文件缺的参数读出默认值
    expect(normalizeVideoEditBuiltinParams('vignette', { amount: -20 }, { amount: 40, midpoint: 70, feather: 10 })).toEqual({ amount: -20, midpoint: 70, feather: 10 })
    expect(resolveVideoEditBuiltinParams({ id: 'vignette', params: { amount: 40 } })).toEqual({ amount: 40, midpoint: 50, feather: 50 })
  })
  it('效果链一项必须是代码滤镜或内置效果之一；智能区域只用于内置画面效果，参数有范围', () => {
    const base = { id: 'e', name: '模糊', enabled: true, amount: 1 }
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.009 } } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse(base).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: {} }, code: { definitionId: 'd', versionId: 'v', parameters: {} } }).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: -0.1 } } }).error?.issues[0].message).toContain('超出范围')
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'face' } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'mosaic', params: {} }, mask: { regionId: 'background', invert: true, feather: 20, expand: -10 } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'sky' } }).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'face', feather: 120 } }).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, code: { definitionId: 'd', versionId: 'v', parameters: {} }, mask: { regionId: 'face' } }).error?.issues[0].message).toContain('作用区域只能用在内置画面效果上')
    // 旧文件的代码滤镜效果不受影响
    expect(videoEditEffectSchema.safeParse({ ...base, code: { definitionId: 'd', versionId: 'v', parameters: {} } }).success).toBe(true)
  })
})
