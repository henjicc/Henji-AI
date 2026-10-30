import { describe, expect, it } from 'vitest'
import { authorLayerBlur, authorLayerSamples, authorPoseMatrix, authorRasterScale, authorStillCrop, authorStillGroups } from './videoEditAuthorLayers'
import type { AuthorLayer, AuthorModule } from './videoEditAuthorModule'

const effect: AuthorModule = { name: '运动层' }
const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } }
const bounds = { x: -20, y: -10, width: 40, height: 20 }
const layer: AuthorLayer = { draw() {}, bounds: [-20, -10, 20, 10], pose: t => ({ x: 100 + t * 1000, y: 200 }) }

describe('direct author layer GPU bridge', () => {
  it('keeps in-focus raster dimensions stable at the reference defocus thresholds', () => {
    expect(authorLayerBlur({ scale: 4, blur: .49 }, 4, 'lens')).toEqual({ radius: 0, pad: 2 })
    expect(authorLayerBlur({ scale: 4, blur: .5 }, 4, 'lens')).toEqual({ radius: .5, pad: 18 })
    expect(authorLayerBlur({ scale: 2, blur: .12 }, 4, 'gaussian')).toEqual({ radius: 0, pad: 2 })
    expect(authorLayerBlur({ scale: 2, blur: .125 }, 4, 'gaussian')).toEqual({ radius: .25, pad: 18 })
  })
  it('keeps the raster size through a typical defocus ramp so cached layers are reused', () => {
    const pads = [.6, 3, 7, 13].map(blur => authorLayerBlur({ scale: 1, blur }, 1, 'lens').pad)
    expect(new Set(pads).size).toBe(1)
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

it('运动层栅格：静态内容至少 2 倍；每帧重画的图层（画着视频）从 1 倍起步，放大时照样按需升档', () => {
  expect(authorRasterScale(1, 4)).toBe(2)
  expect(authorRasterScale(1, 4, true)).toBe(1)
  expect(authorRasterScale(3, 4, true)).toBe(4)
  expect(authorRasterScale(1, 1.5)).toBe(1)
})

describe('相邻无位姿图层的分组', () => {
  const S = { volatile: false, isolated: true }, V = { volatile: true, isolated: true }
  it('按最近是否在变把静止层与在变的层分开，同类相邻的合在一起', () => {
    expect(authorStillGroups([V, S, S, V], 4)).toEqual([{ start: 0, end: 1, volatile: true }, { start: 1, end: 3, volatile: false }, { start: 3, end: 4, volatile: true }])
    expect(authorStillGroups([S, S, S], 4)).toEqual([{ start: 0, end: 3, volatile: false }])
    expect(authorStillGroups([V, V], 4)).toEqual([{ start: 0, end: 2, volatile: true }])
  })
  it('不是 source-over 的层与前面所有层留在同一张画布；后面只用 source-over 的层仍可拆出', () => {
    expect(authorStillGroups([V, S, { volatile: false, isolated: false }, S], 4)).toEqual([{ start: 0, end: 3, volatile: true }, { start: 3, end: 4, volatile: false }])
    expect(authorStillGroups([S, { volatile: false, isolated: false }, V], 4)).toEqual([{ start: 0, end: 2, volatile: false }, { start: 2, end: 3, volatile: true }])
    expect(authorStillGroups([S, V, { volatile: false, isolated: false }], 4)).toEqual([{ start: 0, end: 3, volatile: true }])
  })
  it('栅格数超过上限时，把层数最少的静止组并进两侧在变的组', () => {
    const groups = authorStillGroups([V, S, S, V, S, V, S, S, S], 4)
    expect(groups).toEqual([{ start: 0, end: 1, volatile: true }, { start: 1, end: 3, volatile: false }, { start: 3, end: 6, volatile: true }, { start: 6, end: 9, volatile: false }])
  })
  it('每层都有 clip 时只栅格各 clip 的并集（取整、限在画幅内）；有层没有 clip 就是整帧；全被裁掉为 null', () => {
    expect(authorStillCrop([[10.5, 20, 30, 40.2], [25, 5, 35, 30]], 100, 50)).toEqual({ x: 10, y: 5, width: 25, height: 36 })
    expect(authorStillCrop([[10, 20, 30, 40], undefined], 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(authorStillCrop([[-10, -10, 200, 30]], 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 30 })
    expect(authorStillCrop([[120, 0, 140, 10]], 100, 50)).toBeNull()
  })
})
