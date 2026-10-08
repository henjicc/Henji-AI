import { encodeColorGradeCurve, parseColorGradeCurve, colorGradeCurveLut } from './colorGradeCurves'
import { describe, expect, it } from 'vitest'
import { normalizeVideoEditBuiltinParams, videoEditBuiltinEffect, videoEditBuiltinDefaults } from './builtinEffects'
import { VIDEO_EDIT_COLOR_GRADE, colorGradeLinear, colorGradeSrgb, colorGradeWhiteBalance, suggestColorGradeAutoColor } from './colorGrade'
import { planVideoEditBuiltinEffect } from '../../features/videoEdit/engine/videoEditBuiltinEffectPasses'

describe('ColorGrade 参数与自动校色', () => {
  it('中性只复制，不分配临时纹理；每项都有界面与助手语义，通用参数拒绝未知及越界值', () => {
    expect(videoEditBuiltinEffect('color_grade')).toBe(VIDEO_EDIT_COLOR_GRADE)
    const plan = planVideoEditBuiltinEffect({ id: VIDEO_EDIT_COLOR_GRADE.id, params: videoEditBuiltinDefaults(VIDEO_EDIT_COLOR_GRADE) }, { width: 1920, height: 1080, frame: 0 })
    expect(plan.passes.map(pass => pass.entry)).toEqual(['copy']); expect(plan.scratch).toEqual([])
    expect(VIDEO_EDIT_COLOR_GRADE.params.every(param => param.description && param.tooltip)).toBe(true)
    expect(() => normalizeVideoEditBuiltinParams('color_grade', { exposure: 5 })).toThrow('exposure')
    expect(() => normalizeVideoEditBuiltinParams('color_grade', { unknown: 1 })).toThrow('unknown')
  })
  it('分区工序顺序固定，共用两张交替纹理；回放分辨率不改变非空间参数', () => {
    const params = { exposure: 1, faded_film: 20, curve_master_2: 60, shadow_strength: 20, midtone_strength: 20, highlight_strength: 20, vignette_amount: -30 }
    const make = (height: number) => planVideoEditBuiltinEffect({ id: 'color_grade', params }, { width: height * 16 / 9, height, frame: 0 })
    const full = make(1080); const reduced = make(270)
    expect(full.passes.map(pass => pass.entry)).toEqual(['color_grade_basic', 'color_grade_creative', 'color_grade_curve', 'color_grade_wheel', 'color_grade_wheel', 'color_grade_wheel', 'color_grade_vignette', 'copy'])
    expect(full.scratch).toHaveLength(2)
    full.passes.forEach((pass, i) => expect([...pass.uniforms.slice(4)]).toEqual([...reduced.passes[i].uniforms.slice(4)]))
  })
  it('灰世界建议逆转已知线性偏色，校色后 RGB 收敛到相同值', () => {
    const pixels = Float32Array.from(Array.from({ length: 256 }, (_, i) => { const gray = .03 + i / 255 * .4; return [colorGradeSrgb(gray * 1.2), colorGradeSrgb(gray * .85), colorGradeSrgb(gray * .8), 1] }).flat())
    const params = suggestColorGradeAutoColor(pixels, 1); const gains = colorGradeWhiteBalance(params.temperature as number, params.tint as number)
    const corrected = [1.2, .85, .8].map((x, i) => x * gains[i])
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(1e-6)
    expect(params.exposure).toBeGreaterThanOrEqual(-2); expect(params.exposure).toBeLessThanOrEqual(2)
    const rgb = [.4, .4, .4].map(x => colorGradeSrgb(colorGradeLinear(x)))
    expect(rgb[0]).toBeCloseTo(.4)
  })
  it('分位数增强低反差画面，透明/饱和像素不污染白平衡；空白画面可恢复失败', () => {
    const base = Array.from({ length: 1024 }, (_, i) => { const x = .35 + i / 1023 * .3; return [x, x, x, 1] }).flat()
    const params = suggestColorGradeAutoColor(base, 1)
    expect(params.temperature).toBeCloseTo(0); expect(params.tint).toBeCloseTo(0); expect(params.contrast).toBeGreaterThan(20)
    const mixed = [...base, ...Array.from({ length: 1024 }, () => [1, 0, 0, 0]).flat()]
    expect(suggestColorGradeAutoColor(mixed, 1)).toEqual(params)
    expect(() => suggestColorGradeAutoColor(new Float32Array(100), 1)).toThrow('缺少')
    expect(() => suggestColorGradeAutoColor([1, 2], 1)).toThrow('RGBA')
  })
})

it('调色曲线超过32个控制点仍保留，查找区段沿升序点二分并保持中性曲线', () => {
  const points = Array.from({ length: 101 }, (_, x) => ({ x, y: x }))
  expect(parseColorGradeCurve(encodeColorGradeCurve(points))).toEqual(points)
  const lut = colorGradeCurveLut(points)
  expect(lut[500]).toBeCloseTo(500 / 1023, 6)
})

it('HSL 默认中性及纯键控参数零工序，颜色区间校验与蒙版开关明确', () => {
  const selectors = { hsl_hue_start: 340, hsl_hue_end: 20, hsl_saturation_start: 20, hsl_saturation_end: 90, hsl_hue_feather: 15, hsl_denoise: 80, hsl_blur: 60, hsl_invert: true, hsl_grade_hue: 240 }
  const plan = planVideoEditBuiltinEffect({ id: 'color_grade', params: selectors }, { width: 1920, height: 1080, frame: 0 })
  expect(plan.passes.map(pass => pass.entry)).toEqual(['copy']); expect(plan.scratch).toEqual([])
  expect(() => normalizeVideoEditBuiltinParams('color_grade', { hsl_saturation_start: 80, hsl_saturation_end: 20 })).toThrow('hsl_saturation_start')
  expect(() => normalizeVideoEditBuiltinParams('color_grade', { hsl_hue_start: 361 })).toThrow('hsl_hue_start')
  expect(normalizeVideoEditBuiltinParams('color_grade', selectors)).toMatchObject(selectors)
  expect(VIDEO_EDIT_COLOR_GRADE.params.find(param => param.key === 'hsl_show_mask')?.animatable).toBe(false)
})
it('HSL 羽化/清理复用模糊，锐化线性化且读取同一选区，蒙版不经晕影', () => {
  const params = { hsl_temperature: 20, hsl_sharpen: 30, hsl_denoise: 20, hsl_blur: 10, vignette_amount: -20 }
  const plan = planVideoEditBuiltinEffect({ id: 'color_grade', params }, { width: 1920, height: 1080, frame: 0 })
  const entries = plan.passes.map(pass => pass.entry)
  expect(entries[0]).toBe('color_grade_hsl_key'); expect(entries).toContain('blur'); expect(entries).toContain('color_grade_linear')
  expect(entries.indexOf('color_grade_hsl_correct')).toBeLessThan(entries.indexOf('color_grade_hsl_sharpen'))
  expect(plan.passes.find(pass => pass.entry === 'color_grade_hsl_sharpen')?.mask).toBeTypeOf('number')
  const mask = planVideoEditBuiltinEffect({ id: 'color_grade', params: { ...params, hsl_show_mask: true } }, { width: 1920, height: 1080, frame: 0 })
  expect(mask.passes.map(pass => pass.entry)).not.toContain('color_grade_hsl_sharpen')
  expect(mask.passes.map(pass => pass.entry)).not.toContain('color_grade_vignette')
})
