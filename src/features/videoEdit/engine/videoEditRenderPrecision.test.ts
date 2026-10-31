import { expect, it } from 'vitest'
import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'

const referenceSize = { width: 1920, height: 1080 }
const context = { ...referenceSize, referenceSize, renderScale: 1 }

it('强度归零、source 视图、中性调色及逐像素曝光保留八位，曲线/暗角/模糊只依赖当前参数', () => {
  const glow = (strength: number, amount = 1) => videoEditEffectNeedsFloat({ id: 'glow', params: { strength }, amount }, context)
  expect([glow(0), glow(.01), glow(0), glow(30, 0)]).toEqual([false, true, false, false])
  expect(videoEditEffectNeedsFloat({ id: 'glow', params: { view: 'source' } }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'color_grade', params: {} }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'color_grade', params: { exposure: 2 } }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'color_grade', params: { curve_master_2: 55 } }, context)).toBe(true)
  expect(videoEditEffectNeedsFloat({ id: 'color_grade', params: { curve_master_points: '[{"x":0,"y":0},{"x":100,"y":100}]' } }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'color_grade', params: { vignette_amount: -10 } }, context)).toBe(true)
  expect(videoEditEffectNeedsFloat({ id: 'blur', params: { amount: 0.0 } }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'blur', params: { amount: 0.7 } }, context)).toBe(false)
  expect(videoEditEffectNeedsFloat({ id: 'blur', params: { amount: 0.7 } }, { ...context, quality: 'final' })).toBe(true)
  expect(videoEditEffectNeedsFloat({ id: 'blur', params: { mode: 'lens', amount: 5 } }, context)).toBe(true)
})

it('阈值使用序列参考尺寸，不随栅格倍率、局部纹理或回放比例改变', () => {
  for (const params of [{ amount: 1.39 }, { mode: 'directional', amount: .5 }, { mode: 'radial', amount: .5 }] as Array<Record<string, string | number>>) {
    const effect = { id: 'blur', params }
    const expected = videoEditEffectNeedsFloat(effect, context)
    expect(expected).toBe(false)
    for (const rasterScale of [.25, 1, 2, 4]) {
      expect(videoEditEffectNeedsFloat(effect, { ...context, width: 300, height: 200, layer: { referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 0, y: 0, width: 100, height: 50 }, rasterScale, rasterOrigin: [16, 16], quality: 'interactive' } })).toBe(expected)
      expect(videoEditEffectNeedsFloat(effect, { ...context, renderScale: rasterScale })).toBe(expected)
    }
  }
})

it('非方形和降采样画面的高斯判定与实际渲染规划一致', () => {
  for (const referenceSize of [{ width: 1, height: 1080 }, { width: 1920, height: 1080 }]) {
    for (const renderScale of [.25, 1]) {
      const context = { width: Math.max(1, Math.round(referenceSize.width * renderScale)), height: Math.round(referenceSize.height * renderScale), referenceSize, renderScale, quality: 'interactive' as const }
      for (const axis of ['horizontal', 'vertical']) {
        const effect = { id: 'blur' as const, params: { amount: 2.74, axis } }
        const plan = planVideoEditBuiltinEffect(effect, { ...context, frame: 0 })
        expect(videoEditEffectNeedsFloat(effect, context)).toBe(plan.passes.some(pass => pass.entry !== 'copy'))
      }
    }
  }
})
