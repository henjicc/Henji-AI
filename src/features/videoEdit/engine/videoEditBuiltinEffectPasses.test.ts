import { describe, expect, it } from 'vitest'
import { VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { planVideoEditBuiltinEffect, planVideoEditBuiltinTransition, videoEditGrainSeed, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { resolveVideoEditTransitionParams, VIDEO_EDIT_BUILTIN_TRANSITION_KINDS } from '@/core/videoEdit/transitionParams'
import { VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES, VIDEO_EDIT_BUILTIN_EFFECT_SHADER } from './videoEditBuiltinEffectShaders'

const plan = (id: string, params: Record<string, unknown>, width = 1920, height = 1080, frame = 0): VideoEditBuiltinPlan => planVideoEditBuiltinEffect({ id, params: params as Record<string, number> }, { width, height, frame })
/** 一道工序的全尺寸像素 sigma：降采样倍数 × 低分辨率 sigma。 */
function blurSigmas(result: VideoEditBuiltinPlan): number[] {
  return result.passes.filter(pass => pass.entry === 'blur').map(pass => pass.uniforms[6] * result.width / pass.uniforms[2])
}

describe('内置效果工序与参数打包', () => {
  it('每个效果按默认参数都能规划：最后一道写输出，入口都在着色器里，参数是 16 个 float、开头是目标与输入尺寸', () => {
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => value.media !== 'audio')) {
      const result = plan(definition.id, videoEditBuiltinDefaults(definition))
      expect(result.passes.at(-1)!.target, definition.id).toBe('output')
      for (const pass of result.passes) {
        expect(VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES).toContain(pass.entry)
        expect(VIDEO_EDIT_BUILTIN_EFFECT_SHADER).toContain(`@fragment fn ${pass.entry}(`)
        expect(pass.uniforms).toHaveLength(16)
        expect(pass.uniforms.every(Number.isFinite)).toBe(true)
        const target = typeof pass.target === 'number' ? result.scratch[pass.target] : result
        expect([pass.uniforms[0], pass.uniforms[1]]).toEqual([target.width, target.height])
        // 工序只读已经写过的中间纹理
        if (typeof pass.source === 'number') expect(result.passes.indexOf(pass)).toBeGreaterThan(result.passes.findIndex(value => value.target === pass.source))
      }
    }
  })
  it('高斯模糊按画面高度换算：不同渲染尺寸下相对模糊量相同；大半径先降采样，每道取样数有上限', () => {
    const full = plan('gaussian_blur', { strength: 100 }); const quarter = plan('gaussian_blur', { strength: 100 }, 480, 270)
    expect(full.passes.filter(pass => pass.entry === 'copy').length).toBeGreaterThan(2)
    expect(full.passes.filter(pass => pass.entry === 'blur').every(pass => pass.uniforms[7] <= 10)).toBe(true)
    // 低分辨率工序里的 sigma × 降采样倍数，加上降采样本身的模糊，约等于要求的全尺寸 sigma（画面高度的 3%）
    expect(Math.max(...blurSigmas(full))).toBeLessThan(0.03 * 1080)
    expect(Math.abs(Math.max(...blurSigmas(full)) / 1080 / (Math.max(...blurSigmas(quarter)) / 270) - 1)).toBeLessThan(.05)
    // 小半径不降采样，横竖两道直接写输出
    const light = plan('gaussian_blur', { strength: 5 })
    expect(light.passes.map(pass => pass.entry)).toEqual(['blur', 'blur'])
    expect(light.passes[0].uniforms.slice(4, 6)).toEqual(new Float32Array([1 / 1920, 0]))
    expect(light.passes[1].uniforms.slice(4, 6)).toEqual(new Float32Array([0, 1 / 1080]))
    // 只模糊水平方向时垂直方向不降采样
    const horizontal = plan('gaussian_blur', { strength: 100, dimensions: 'horizontal' })
    expect(horizontal.scratch.every(size => size.height === 1080)).toBe(true)
    expect(horizontal.passes.filter(pass => pass.entry === 'blur').every(pass => pass.uniforms[5] === 0)).toBe(true)
    expect(plan('gaussian_blur', { strength: 0 }).passes.map(pass => pass.entry)).toEqual(['copy'])
    expect(plan('gaussian_blur', { strength: 30, repeat_edges: false }).passes.find(pass => pass.entry === 'blur')!.uniforms[8]).toBe(0)
  })
  it('颜色与风格化参数换算：曝光是线性增益，黑白是零饱和度，色度抠像传入色度坐标，马赛克块按画面高度', () => {
    expect([...plan('exposure', { exposure: 1 }).passes[0].uniforms.slice(4, 7)]).toEqual([2, 2, 2])
    expect([...plan('black_white', {}).passes[0].uniforms.slice(4, 8)]).toEqual([1, 0, 0, 0])
    const key = plan('chroma_key', { key_color: VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX, tolerance: 30, softness: 10, spill: 50 }).passes[0].uniforms
    expect(key[4]).toBeLessThan(0); expect(key[5]).toBeLessThan(0); expect(key[8]).toBeCloseTo(.5)
    const mosaic = plan('mosaic', { block_size: 30 }).passes[0].uniforms
    expect(mosaic[4] * 1920).toBeCloseTo(0.03 * 1080); expect(mosaic[5] * 1080).toBeCloseTo(0.03 * 1080)
    const crop = plan('crop', { left: 10, top: 12, right: 0, bottom: 12, feather: 0 }).passes[0].uniforms
    expect([...crop.slice(4, 8)].map(value => Math.round(value * 100) / 100)).toEqual([.1, .12, 1, .88])
    expect(plan('flip', { axis: 'vertical' }).passes[0].uniforms.slice(4, 6)).toEqual(new Float32Array([0, 1]))
  })
  it('胶片颗粒的种子只由帧号决定：同一帧预览与导出相同，相邻帧不同', () => {
    expect(plan('film_grain', {}, 1920, 1080, 42).passes[0].uniforms[6]).toBe(videoEditGrainSeed(42))
    expect(videoEditGrainSeed(42)).toBe(videoEditGrainSeed(42)); expect(videoEditGrainSeed(42)).not.toBe(videoEditGrainSeed(43))
  })
  it('回放分辨率（4.9）：颗粒不能细于一个像素，降低分辨率时幅度按每个像素覆盖的颗粒数减弱；完整分辨率不变', () => {
    const grain = (height: number, renderScale?: number, size = 30) => planVideoEditBuiltinEffect({ id: 'film_grain', params: { amount: 40, size } }, { width: Math.round(height * 16 / 9), height, frame: 0, renderScale }).passes[0].uniforms
    const full = grain(1080); const same = grain(1080, 1)
    expect(same[4]).toBe(full[4])
    // 1080 下 30 号颗粒约 1.7 像素；1/4 时一个像素盖 4×4 个序列像素，约 2.3×2.3 个颗粒 → 幅度约为 1/2.3
    const quarter = grain(270, 0.25)
    expect(quarter[5]).toBeCloseTo(full[5] / 4)
    expect(quarter[4] / full[4]).toBeCloseTo(0.25 * full[5], 3)
    // 粗颗粒（一颗大于缩小后的一个像素）在 1/2 下幅度不变
    expect(grain(540, 0.5, 100)[4]).toBeCloseTo(grain(1080, 1, 100)[4])
  })
  it('视频过渡（4.7）：每种过渡在任意进度都能规划，入口都在着色器里；羽化按画面高度换算；单侧标记写进参数', () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS) {
      for (const progress of [0, 0.3, 1]) {
        const result = planVideoEditBuiltinTransition({ kind, params: resolveVideoEditTransitionParams(kind, {}), progress }, { width: 1920, height: 1080 })
        expect(result.passes.at(-1)!.target, kind).toBe('output')
        for (const pass of result.passes) {
          expect(VIDEO_EDIT_BUILTIN_EFFECT_SHADER).toContain(`@fragment fn ${pass.entry}(`)
          expect(pass.uniforms.every(Number.isFinite)).toBe(true)
        }
      }
    }
    const wipe = (height: number) => planVideoEditBuiltinTransition({ kind: 'wipe', params: resolveVideoEditTransitionParams('wipe', { feather: 50 }), progress: 0.5, emptyIncoming: true }, { width: height * 2, height }).passes[0].uniforms
    expect(wipe(1080)[6] / 1080).toBeCloseTo(wipe(540)[6] / 540)
    expect(wipe(1080)[6]).toBeCloseTo(0.1 * 1080)
    expect([...wipe(1080).slice(12, 15)]).toEqual([0.5, 0, 1])
    expect(() => planVideoEditBuiltinTransition({ kind: 'wipe', params: {}, progress: 2 }, { width: 4, height: 4 })).toThrow('进度')
  })
})
