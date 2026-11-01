import { describe, expect, it } from 'vitest'
import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import { lightLeakFlicker } from './lightLeak'
import { BLACK_HEX } from '@/core/theme/colorTokens'

const size = { width: 1920, height: 1080, referenceSize: { width: 1920, height: 1080 }, renderScale: 1 }
const plan = (id: string, params: Record<string, unknown>, frame = 0) => planVideoEditBuiltinEffect({ id, params: params as Record<string, number> }, { width: 1920, height: 1080, frame, frameDuration: 1 / 30 })

describe('镜头光晕、漏光', () => {
  it('不出光（亮度、强度为 0 或光是黑色）时规划只剩复制、不要求浮点合成；出光时要求浮点合成', () => {
    for (const [id, params] of [['lens_flare', { brightness: 0, ghosts: 80 }], ['lens_flare', { color: BLACK_HEX }], ['light_leak', { amount: 0, flicker: 100 }], ['light_leak', { hot_color: BLACK_HEX, edge_color: BLACK_HEX }]] as const) {
      expect(plan(id, params).passes.map(pass => pass.entry)).toEqual(['copy'])
      expect(videoEditEffectNeedsFloat({ id, params }, size)).toBe(false)
      expect(videoEditEffectNeedsFloat({ id, params: {} }, size)).toBe(true)
    }
  })

  it('漏光在第 0 帧以外缺帧时长时报错，不悄悄停在第 0 秒；预热、精度判定的第 0 帧不受影响', () => {
    expect(() => planVideoEditBuiltinEffect({ id: 'light_leak', params: {} }, { width: 64, height: 36, frame: 5 })).toThrow('帧时长')
    expect(planVideoEditBuiltinEffect({ id: 'light_leak', params: {} }, { width: 64, height: 36, frame: 0 }).passes.length).toBeGreaterThan(1)
    expect(planVideoEditBuiltinEffect({ id: 'light_leak', params: { speed: 0, flicker: 0 } }, { width: 64, height: 36, frame: 5 }).passes.length).toBeGreaterThan(1)
  })

  it('漏光速度与闪烁为 0 时与时间无关；闪烁随时间平滑起伏，相邻帧不跳变', () => {
    const still = { speed: 0, flicker: 0 }
    expect(plan('light_leak', still, 0).passes.map(pass => [...pass.uniforms])).toEqual(plan('light_leak', still, 219).passes.map(pass => [...pass.uniforms]))
    expect(plan('light_leak', { flicker: 0 }, 0).passes[0].uniforms).not.toEqual(plan('light_leak', { flicker: 0 }, 60).passes[0].uniforms)
    let jump = 0, low = 1, high = 0
    for (let frame = 0; frame < 600; frame++) {
      const value = lightLeakFlicker(1, frame / 60, 3)
      if (frame) jump = Math.max(jump, Math.abs(value - lightLeakFlicker(1, (frame - 1) / 60, 3)))
      low = Math.min(low, value); high = Math.max(high, value)
    }
    expect(jump).toBeLessThan(0.05)
    expect(high - low).toBeGreaterThan(0.4)
  })
})
