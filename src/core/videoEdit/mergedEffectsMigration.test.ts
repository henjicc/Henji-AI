import { describe, expect, it } from 'vitest'
import { migrateVideoEditMergedEffects } from './mergedEffectsMigration'
import { blurLensRadius, blurLineLength, blurSigma, blurZoomRange } from './blur'
import { WHITE_HEX } from '../theme/colorTokens'
import { evaluateVideoEditKeyframes } from './keyframes'

describe('效果库合并后的存档换算：旧模糊并成“模糊”、旧暗角负数量换白色', () => {
  const clip = (builtin: unknown) => ({ sequences: [{ clips: [{ id: 'c', effects: [{ id: 'e', name: '旧', enabled: true, amount: 0.5, builtin }] }] }] })
  const migrated = (builtin: unknown) => (migrateVideoEditMergedEffects(clip(builtin)) as ReturnType<typeof clip>).sequences[0].clips[0].effects[0]
  it('换算后模糊范围与旧效果相同，关键帧逐点换算，不改原内容', () => {
    const input = clip({ id: 'gaussian_blur', params: { sigma_fraction_height: 0.009, edge_mode: 'transparent' }, curves: { sigma_fraction_height: [{ time: 0, value: 0.003, interpolation: 'bezier', easeValues: [0.003, 0.03] }, { time: 10, value: 0.03, interpolation: 'linear' }] } })
    const before = structuredClone(input)
    const effect = (migrateVideoEditMergedEffects(input) as typeof input).sequences[0].clips[0].effects[0]
    expect(input).toEqual(before)
    expect(effect).toMatchObject({ id: 'e', name: '旧', amount: 0.5, builtin: { id: 'blur', params: { mode: 'uniform', axis: 'both', repeat_edges: false } } })
    const { params, curves } = effect.builtin as { params: { amount: number }; curves: { amount: Array<{ value: number; easeValues?: number[] }> } }
    expect(blurSigma(params.amount)).toBeCloseTo(0.009, 4)
    expect(blurSigma(curves.amount[0].value)).toBeCloseTo(0.003, 4); expect(blurSigma(curves.amount.at(-1)!.value)).toBeCloseTo(0.03, 4)
    expect(Object.keys(curves)).toEqual(['amount'])
  })
  it('贝塞尔与修剪后的曲线逐帧换算：每一帧的模糊与旧曲线相同，修剪接缝不跳变', () => {
    // 修剪后的贝塞尔段：easeRange 截在中间，easeValues 记着原来两端的值；后面接一段线性和一段定格。
    const old = [
      { time: 0, value: 0.05, interpolation: 'bezier' as const, bezier: [0.4, 0, 0.2, 1] as [number, number, number, number], easeRange: [0.3, 1] as [number, number], easeValues: [0.02, 0.08] as [number, number] },
      { time: 20, value: 0.08, interpolation: 'linear' as const },
      { time: 40, value: 0.004, interpolation: 'hold' as const },
      { time: 50, value: 0.01, interpolation: 'linear' as const },
    ]
    const effect = migrated({ id: 'gaussian_blur', params: { sigma_fraction_height: 0.05 }, curves: { sigma_fraction_height: old } })
    const curve = (effect.builtin as { curves: { amount: Parameters<typeof evaluateVideoEditKeyframes>[0] } }).curves.amount
    for (let frame = 0; frame <= 60; frame++) {
      const before = evaluateVideoEditKeyframes(old, frame, 0.05) as number
      const after = blurSigma(evaluateVideoEditKeyframes(curve, frame, 0) as number)
      expect(Math.abs(after - before) / before, `第 ${frame} 帧`).toBeLessThan(0.005)
    }
    // 逐帧样本按容差合并，点数少于帧数。
    expect(curve!.length).toBeLessThan(40)
  })
  it('旧暗角的负数量换成正数量配白色，关键帧一起换；正负都有的曲线保留原值；旧镜头模糊按圆盘半径换算', () => {
    expect(migrated({ id: 'vignette', params: { amount: -40, midpoint: 60 } }).builtin).toEqual({ id: 'vignette', params: { amount: 40, midpoint: 60, color: WHITE_HEX } })
    const curved = migrated({ id: 'vignette', params: { amount: -10 }, curves: { amount: [{ time: 0, value: -10, interpolation: 'linear' }, { time: 5, value: -60, interpolation: 'linear' }] } }).builtin as { curves: { amount: Array<{ value: number }> } }
    expect(curved.curves.amount.map(point => point.value)).toEqual([10, 60])
    const mixed = { id: 'vignette', params: { amount: 20 }, curves: { amount: [{ time: 0, value: -10, interpolation: 'linear' }, { time: 5, value: 30, interpolation: 'linear' }] } }
    expect(migrated(mixed).builtin).toEqual(mixed)
    expect(migrated({ id: 'vignette', params: { amount: 30 } }).builtin).toEqual({ id: 'vignette', params: { amount: 30 } })
    const lens = migrated({ id: 'lens_blur', params: { radius_fraction_height: 0.02 } }).builtin as { params: { mode: string; amount: number } }
    expect(lens.params.mode).toBe('lens'); expect(blurLensRadius(lens.params.amount)).toBeCloseTo(0.02, 4)
  })
  it('换算不截断：超出模糊度上限的旧值照样存入', () => {
    const huge = migrated({ id: 'gaussian_blur', params: { sigma_fraction_height: 1000 } }).builtin as { params: { amount: number } }
    expect(huge.params.amount).toBeGreaterThan(450)
  })
  it('方向模糊按直线长度、缩放模糊按缩放量换算；缺的参数按旧默认值；其他效果不动', () => {
    const line = migrated({ id: 'directional_blur', params: { direction: 45 } }).builtin as { params: { amount: number; angle: number; mode: string } }
    expect(line.params).toMatchObject({ mode: 'directional', angle: 45 }); expect(blurLineLength(line.params.amount)).toBeCloseTo(0.03, 4)
    const zoom = migrated({ id: 'zoom_blur', params: { strength: 50, center_x: 20 } }).builtin as { params: { amount: number; center_x: number; center_y: number } }
    expect(zoom.params).toMatchObject({ mode: 'radial', center_x: 20, center_y: 50 }); expect(blurZoomRange(zoom.params.amount)).toBeCloseTo(0.1, 4)
    const other = { id: 'glow', params: { strength: 20 } }
    expect(migrated(other).builtin).toEqual(other)
  })
})
