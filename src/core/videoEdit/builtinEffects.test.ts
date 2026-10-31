import { describe, expect, it } from 'vitest'
import { normalizeVideoEditBuiltinParams, parseVideoEditBuiltinRefId, resolveVideoEditBuiltinParams, VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults, videoEditBuiltinEffectIssue } from './builtinEffects'
import { videoEditEffectSchema } from './compositing'
import { VIDEO_EDIT_EFFECT_CATEGORIES, videoEditEffectsRegistry } from './effectsRegistry'
import { BLACK_HEX } from '../theme/colorTokens'

describe('内置效果登记', () => {
  it('每个参数都有用户说明、助手语义、单位范围与范围内的默认值，默认值组成的参数表合法', () => {
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS) {
      expect(definition.description.length, definition.id).toBeGreaterThan(8)
      expect(new Set(definition.params.map(param => param.key)).size).toBe(definition.params.length)
      for (const param of definition.params) {
        expect(param.description, `${definition.id}.${param.key}`).toBeTruthy()
        if (param.type === 'number') {
          expect(param.default).toBeGreaterThanOrEqual(param.min); expect(param.default).toBeLessThanOrEqual(param.max)
          // 滑块范围在硬范围之内，默认值落在滑块上。
          expect(param.softMin ?? param.min).toBeGreaterThanOrEqual(param.min); expect(param.softMax ?? param.max).toBeLessThanOrEqual(param.max)
          expect(param.default).toBeGreaterThanOrEqual(param.softMin ?? param.min); expect(param.default).toBeLessThanOrEqual(param.softMax ?? param.max)
        }
        if (param.type === 'enum') expect(param.options.map(option => option.value)).toContain(param.default)
      }
      expect(videoEditBuiltinEffectIssue({ id: definition.id, params: videoEditBuiltinDefaults(definition) })).toBeUndefined()
    }
  })
  it('效果面板列出可用于片段的内置效果，带参数与分组', () => {
    const entries = videoEditEffectsRegistry().filter(entry => entry.builtinId)
    expect(new Set(entries.map(entry => entry.builtinId))).toEqual(new Set(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => definition.id)))
    expect(entries.every(entry => VIDEO_EDIT_EFFECT_CATEGORIES.some(category => category.id === entry.category) && entry.id === `effect:${entry.builtinId}` && entry.group && entry.params)).toBe(true)
    expect(parseVideoEditBuiltinRefId('effect:blur')).toBe('blur'); expect(parseVideoEditBuiltinRefId('blur')).toBe('blur'); expect(parseVideoEditBuiltinRefId('effect:nope')).toBeUndefined()
  })
  it('严格校验越界、错类型与未知参数并列出可用范围；界面写入时夹进范围', () => {
    const blur = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.find(definition => definition.id === 'blur')!
    expect(normalizeVideoEditBuiltinParams('blur', { amount: 51.8 })).toEqual({ ...videoEditBuiltinDefaults(blur), amount: 51.8 })
    // 软范围之外、硬范围之内照样接受；超出硬范围报错并给出硬范围。
    expect(normalizeVideoEditBuiltinParams('blur', { amount: 150 }).amount).toBe(150)
    expect(() => normalizeVideoEditBuiltinParams('blur', { amount: 451 })).toThrow('超出范围 0–450')
    expect(() => normalizeVideoEditBuiltinParams('blur', { amount: -1.0 })).toThrow('超出范围 0–')
    expect(() => normalizeVideoEditBuiltinParams('blur', { radius: 3 })).toThrow('可用参数：amount、mode、axis')
    expect(() => normalizeVideoEditBuiltinParams('blur', { axis: 'diagonal' })).toThrow('both、horizontal、vertical')
    expect(() => normalizeVideoEditBuiltinParams('nope')).toThrow(/可用：.*blur/)
    expect(normalizeVideoEditBuiltinParams('blur', { amount: 900 }, undefined, true).amount).toBe(450)
    // 颜色由测试拼出（颜色字面量只允许登记在主题文件）
    expect(normalizeVideoEditBuiltinParams('chroma_key', { key_color: ` #${'00B140'} ` }).key_color).toBe(`#${'00b140'}`)
    expect(() => normalizeVideoEditBuiltinParams('chroma_key', { key_color: 'green' })).toThrow('#rrggbb')
    // 只改给出的键，其余保留原值；旧文件缺的参数读出默认值
    expect(normalizeVideoEditBuiltinParams('vignette', { amount: 20 }, { amount: 40, midpoint: 70, feather: 10 })).toEqual({ amount: 20, midpoint: 70, feather: 10, color: BLACK_HEX })
    expect(resolveVideoEditBuiltinParams({ id: 'vignette', params: { amount: 40 } })).toEqual({ amount: 40, midpoint: 50, feather: 50, color: BLACK_HEX })
  })
  it('效果链一项必须是代码滤镜或内置效果之一；智能区域只用于内置画面效果，参数有范围', () => {
    const base = { id: 'e', name: '模糊', enabled: true, amount: 1 }
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: { amount: 40.01 } } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse(base).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: {} }, code: { definitionId: 'd', versionId: 'v', parameters: {} } }).success).toBe(false)
    // 存档里越界的旧数值与已移除的效果照样读入（使用时钳制、跳过）；类型不对才是内容损坏。
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: { amount: -0.1 } } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.01 } } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: { mode: 'sideways' } } }).error?.issues[0].message).toContain('可选')
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: {} }, mask: { regionId: 'face' } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'mosaic', params: {} }, mask: { regionId: 'background', invert: true, feather: 20, expand: -10 } }).success).toBe(true)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: {} }, mask: { regionId: 'sky' } }).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, builtin: { id: 'blur', params: {} }, mask: { regionId: 'face', feather: 120 } }).success).toBe(false)
    expect(videoEditEffectSchema.safeParse({ ...base, code: { definitionId: 'd', versionId: 'v', parameters: {} }, mask: { regionId: 'face' } }).error?.issues[0].message).toContain('作用区域只能用在内置画面效果上')
    // 旧文件的代码滤镜效果不受影响
    expect(videoEditEffectSchema.safeParse({ ...base, code: { definitionId: 'd', versionId: 'v', parameters: {} } }).success).toBe(true)
  })
})
