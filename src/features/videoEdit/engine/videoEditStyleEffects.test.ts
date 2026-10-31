import { describe, expect, it } from 'vitest'
import { includedEffectParams } from '@/core/videoEdit/effectIncludes'
import { GLOW_EFFECT_DEFINITION } from '@/core/videoEdit/glow'
import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { strokeJumpSteps } from './stroke'
import { dropShadowBleed } from '@/core/videoEdit/dropShadow'

const size = { width: 1920, height: 1080, referenceSize: { width: 1920, height: 1080 }, renderScale: 1 }
const floatFor = (id: string, params: Record<string, unknown>): boolean => videoEditEffectNeedsFloat({ id, params: params as Record<string, number> }, size)

describe('投影、描边、扫光、溶解显影', () => {
  it('恒等状态的规划只剩复制或调原画不透明度，也不要求浮点合成', () => {
    for (const [id, params] of [['drop_shadow', { opacity: 0 }], ['light_sweep', { intensity: 0, glow_strength: 60 }], ['light_sweep', { progress: 100 }], ['dissolve_reveal', { progress: 100, edge_width: 40 }], ['stroke', { width: 0 }]] as const) {
      expect(planVideoEditBuiltinEffect({ id, params: params as Record<string, number> }, { width: 64, height: 36, frame: 0 }).passes.map(pass => pass.entry)).toEqual(['copy'])
      expect(floatFor(id, params)).toBe(false)
    }
    expect(floatFor('drop_shadow', {})).toBe(true)
    expect(floatFor('stroke', {})).toBe(false)
  })

  it('投影柔和度最大时外扩封顶在一个画面对角线，图层纹理不会撑到设备上限', () => {
    const reference = { referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 0, y: 0, width: 1920, height: 1080 }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
    const bleed = dropShadowBleed({ opacity: 40, distance: 0, softness: 200 }, reference)
    expect(bleed).toBeLessThanOrEqual(Math.hypot(1920, 1080) / 1080 + 2 / 1080)
  })

  it('描边 JFA 步长从覆盖距离向上取 2 的幂，最后多一道 1', () => {
    expect(strokeJumpSteps(4.6)).toEqual([8, 4, 2, 1, 1])
    expect(strokeJumpSteps(1)).toEqual([1, 1])
  })

  it('包含效果改默认值必须同时给说明；只取指定的键', () => {
    const params = includedEffectParams(GLOW_EFFECT_DEFINITION, 'glow', '发光', { keys: ['strength', 'radius'], overrides: { radius: { default: 30, text: '30（默认）' } } })
    expect(params.map(param => [param.key, param.default, param.description])).toEqual([['glow_strength', 40, GLOW_EFFECT_DEFINITION.params[0].description], ['glow_radius', 30, '30（默认）']])
    expect(() => includedEffectParams(GLOW_EFFECT_DEFINITION, 'glow', '发光', { overrides: { missing: { default: 1, text: '' } } })).toThrow('没有参数 missing')
  })
})
