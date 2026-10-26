import { describe, expect, it } from 'vitest'
import { authorLayerBlur, authorLayerSamples, authorPoseMatrix } from './videoEditAuthorLayers'
import type { AuthorLayer, AuthorModule } from './videoEditAuthorModule'

const effect: AuthorModule = { name: '运动层' }
const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } }
const bounds = { x: -20, y: -10, width: 40, height: 20 }
const layer: AuthorLayer = { draw() {}, bounds: [-20, -10, 20, 10], pose: t => ({ x: 100 + t * 1000, y: 200 }) }

describe('direct author layer GPU bridge', () => {
  it('keeps in-focus raster dimensions stable at the reference defocus thresholds', () => {
    expect(authorLayerBlur({ scale: 4, blur: .49 }, 4, 'lens')).toEqual({ radius: 0, pad: 2 })
    expect(authorLayerBlur({ scale: 4, blur: .5 }, 4, 'lens')).toEqual({ radius: .5, pad: 3 })
    expect(authorLayerBlur({ scale: 2, blur: .12 }, 4, 'gaussian')).toEqual({ radius: 0, pad: 2 })
    expect(authorLayerBlur({ scale: 2, blur: .125 }, 4, 'gaussian')).toEqual({ radius: .25, pad: 3 })
  })
  it('uses Canvas radians and independent scale axes', () => {
    const m = authorPoseMatrix({ x: 5, y: 6, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 })
    expect(m[0]).toBeCloseTo(0); expect(m[1]).toBeCloseTo(2)
    expect(m[2]).toBeCloseTo(-3); expect(m[3]).toBeCloseTo(0)
    expect(m.slice(4)).toEqual([5, 6])
  })
  it('matches the reference 16 midpoint probes and shutter samples', () => {
    const samples = authorLayerSamples(layer, effect, info, bounds)
    // 1000 px/s * 1/120 s * 15/16 ≈ 7.3 px；每次取样沿运动方向拉长到间距，约每 4 像素一个样本
    expect(samples).toHaveLength(2)
    expect(samples[0].pose!.matrix[4]).toBeCloseTo(1097.9166666667)
    expect(samples.at(-1)!.pose!.matrix[4]).toBeCloseTo(1102.0833333333)
    expect(samples.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1)
  })
  it('序列运动模糊总开关关掉时，带位姿的图层只取当前时刻一个姿态', () => {
    const samples = authorLayerSamples(layer, effect, info, bounds, undefined, false)
    expect(samples).toHaveLength(1)
    expect(samples[0].pose!.matrix[4]).toBeCloseTo(1100)
  })
  it.each([{ motionBlur: { shutter: 0 } }, { motionBlur: { shutter: 180 } }])('honors the layer switch with %j', settings => {
    const samples = authorLayerSamples({ ...layer, motionBlur: false }, { ...effect, ...settings }, info, bounds)
    expect(samples).toHaveLength(1)
    expect(samples[0].pose!.matrix).toEqual([1, 0, -0, 1, 1100, 200])
  })
  it('the global shutter switch overrides a layer that enables motion blur', () => {
    const samples = authorLayerSamples({ ...layer, motionBlur: true }, { ...effect, motionBlur: { shutter: 0 } }, info, bounds)
    expect(samples).toHaveLength(1)
    expect(samples[0].pose!.matrix[4]).toBe(1100)
  })
  it('rejects invalid poses rather than silently rendering black', () => {
    expect(() => authorLayerSamples({ ...layer, pose: () => ({ x: NaN }) }, effect, info, bounds)).toThrow('有限数值')
  })
  it('preserves transparent shutter samples when a layer appears', () => {
    const samples = authorLayerSamples({ ...layer, pose: t => t < 1 ? null : { x: 10, y: 10 } }, effect, info, bounds)
    expect(samples).toHaveLength(4)
    expect(samples.filter(sample => sample.pose === null)).toHaveLength(2)
    expect(samples.filter(sample => sample.pose).reduce((sum, sample) => sum + sample.weight, 0)).toBe(.5)
  })
})
