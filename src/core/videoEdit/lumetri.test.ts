import { encodeLumetriCurve, parseLumetriCurve, lumetriCurveLut } from './lumetriCurves'
import { describe, expect, it } from 'vitest'
import { normalizeVideoEditBuiltinParams, videoEditBuiltinEffect, videoEditBuiltinDefaults } from './builtinEffects'
import { VIDEO_EDIT_LUMETRI, lumetriLinear, lumetriSrgb, lumetriWhiteBalance, suggestLumetriAutoColor } from './lumetri'
import { planVideoEditBuiltinEffect } from '../../features/videoEdit/engine/videoEditBuiltinEffectPasses'

describe('Lumetri 参数与自动校色', () => {
  it('中性只复制，不分配临时纹理；每项都有界面与助手语义，通用参数拒绝未知及越界值', () => {
    expect(videoEditBuiltinEffect('lumetri_color')).toBe(VIDEO_EDIT_LUMETRI)
    const plan = planVideoEditBuiltinEffect({ id: VIDEO_EDIT_LUMETRI.id, params: videoEditBuiltinDefaults(VIDEO_EDIT_LUMETRI) }, { width: 1920, height: 1080, frame: 0 })
    expect(plan.passes.map(pass => pass.entry)).toEqual(['copy']); expect(plan.scratch).toEqual([])
    expect(VIDEO_EDIT_LUMETRI.params.every(param => param.description && param.tooltip)).toBe(true)
    expect(() => normalizeVideoEditBuiltinParams('lumetri_color', { exposure: 5 })).toThrow('exposure')
    expect(() => normalizeVideoEditBuiltinParams('lumetri_color', { unknown: 1 })).toThrow('unknown')
  })
  it('分区工序顺序固定，共用两张交替纹理；回放分辨率不改变非空间参数', () => {
    const params = { exposure: 1, faded_film: 20, curve_master_2: 60, shadow_strength: 20, midtone_strength: 20, highlight_strength: 20, vignette_amount: -30 }
    const make = (height: number) => planVideoEditBuiltinEffect({ id: 'lumetri_color', params }, { width: height * 16 / 9, height, frame: 0 })
    const full = make(1080); const reduced = make(270)
    expect(full.passes.map(pass => pass.entry)).toEqual(['lumetri_basic', 'lumetri_creative', 'lumetri_curve', 'lumetri_wheel', 'lumetri_wheel', 'lumetri_wheel', 'lumetri_vignette', 'copy'])
    expect(full.scratch).toHaveLength(2)
    full.passes.forEach((pass, i) => expect([...pass.uniforms.slice(4)]).toEqual([...reduced.passes[i].uniforms.slice(4)]))
  })
  it('灰世界建议逆转已知线性偏色，校色后 RGB 收敛到相同值', () => {
    const pixels = Float32Array.from(Array.from({ length: 256 }, (_, i) => { const gray = .03 + i / 255 * .4; return [lumetriSrgb(gray * 1.2), lumetriSrgb(gray * .85), lumetriSrgb(gray * .8), 1] }).flat())
    const params = suggestLumetriAutoColor(pixels, 1); const gains = lumetriWhiteBalance(params.temperature as number, params.tint as number)
    const corrected = [1.2, .85, .8].map((x, i) => x * gains[i])
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(1e-6)
    expect(params.exposure).toBeGreaterThanOrEqual(-2); expect(params.exposure).toBeLessThanOrEqual(2)
    const rgb = [.4, .4, .4].map(x => lumetriSrgb(lumetriLinear(x)))
    expect(rgb[0]).toBeCloseTo(.4)
  })
  it('分位数增强低反差画面，透明/饱和像素不污染白平衡；空白画面可恢复失败', () => {
    const base = Array.from({ length: 1024 }, (_, i) => { const x = .35 + i / 1023 * .3; return [x, x, x, 1] }).flat()
    const params = suggestLumetriAutoColor(base, 1)
    expect(params.temperature).toBeCloseTo(0); expect(params.tint).toBeCloseTo(0); expect(params.contrast).toBeGreaterThan(20)
    const mixed = [...base, ...Array.from({ length: 1024 }, () => [1, 0, 0, 0]).flat()]
    expect(suggestLumetriAutoColor(mixed, 1)).toEqual(params)
    expect(() => suggestLumetriAutoColor(new Float32Array(100), 1)).toThrow('缺少')
    expect(() => suggestLumetriAutoColor([1, 2], 1)).toThrow('RGBA')
  })
})

it('调色曲线超过32个控制点仍保留，查找区段沿升序点二分并保持中性曲线', () => {
  const points = Array.from({ length: 101 }, (_, x) => ({ x, y: x }))
  expect(parseLumetriCurve(encodeLumetriCurve(points))).toEqual(points)
  const lut = lumetriCurveLut(points)
  expect(lut[500]).toBeCloseTo(500 / 1023, 6)
})
