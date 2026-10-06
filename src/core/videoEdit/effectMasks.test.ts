import { describe, expect, it } from 'vitest'
import {
  editVideoEditMaskShape, fillVideoEditMaskPolygon, flattenVideoEditMaskPath, rasterizeVideoEditMaskShapes, transformVideoEditMaskShape,
  videoEditEffectMaskSchema, videoEditMaskShapeBounds, videoEditMaskShapePoints, type VideoEditMaskShape,
} from './effectMasks'
import { videoEditEffectSchema } from './compositing'

const coverage = (mask: Uint8Array): number => mask.reduce((sum, value) => sum + value, 0) / 255

describe('作用区域：存储格式', () => {
  it('智能区域与手绘遮罩按 regionId 区分；形状必须按种类给 box 或 points', () => {
    expect(videoEditEffectMaskSchema.parse({ regionId: 'face', feather: 10 })).toEqual({ regionId: 'face', feather: 10 })
    const shapes = { regionId: 'shapes', shapes: [{ id: 'a', kind: 'ellipse', box: [0.1, 0.1, 0.5, 0.5], mode: 'subtract', opacity: 50 }] }
    expect(videoEditEffectMaskSchema.parse(shapes)).toEqual(shapes)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [{ id: 'a', kind: 'path', box: [0, 0, 1, 1] }] })).toThrow(/points/)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [{ id: 'a', kind: 'rect', box: [0, 0, 1, 1] }, { id: 'a', kind: 'rect', box: [0, 0, 1, 1] }] })).toThrow(/重复/)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [] })).toThrow()
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'sky' })).toThrow()
  })

  it('效果上的手绘遮罩随效果一起校验，只允许内置画面效果', () => {
    const effect = { id: 'e', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'shapes', shapes: [{ id: 's', kind: 'rect', box: [0, 0, 0.5, 0.5] }] } }
    expect(videoEditEffectSchema.parse(effect).mask).toEqual(effect.mask)
    expect(() => videoEditEffectSchema.parse({ ...effect, builtin: { id: 'compressor', params: {} } })).toThrow(/作用区域/)
  })
})

describe('作用区域：手绘遮罩栅格化', () => {
  const W = 200; const H = 100
  it('矩形按像素精确覆盖（含半像素边）', () => {
    const mask = rasterizeVideoEditMaskShapes([{ id: 'r', kind: 'rect', box: [0.1025, 0.2, 0.5, 0.5], feather: 0 }], W, H)
    expect(coverage(mask)).toBeCloseTo(100 * 50, -1)
    expect(mask[45 * W + 60]).toBe(255); expect(mask[5 * W + 5]).toBe(0)
    // 左边落在 20.5 像素：那一列覆盖一半
    expect(mask[45 * W + 20]).toBeGreaterThan(115); expect(mask[45 * W + 20]).toBeLessThan(140)
  })

  it('椭圆转成贝塞尔后面积 ≈ πab', () => {
    const mask = rasterizeVideoEditMaskShapes([{ id: 'e', kind: 'ellipse', box: [0.25, 0.1, 0.5, 0.8], feather: 0 }], W, H)
    expect(coverage(mask) / (Math.PI * 50 * 40)).toBeCloseTo(1, 2)
  })

  it('模式按顺序合成：相加取并、相减挖掉、交叉取交；第一个是相减时从整个画面开始', () => {
    const left: VideoEditMaskShape = { id: 'l', kind: 'rect', box: [0, 0, 0.6, 1], feather: 0 }
    const right: VideoEditMaskShape = { id: 'r', kind: 'rect', box: [0.4, 0, 0.6, 1], feather: 0 }
    expect(coverage(rasterizeVideoEditMaskShapes([left, right], W, H))).toBeCloseTo(W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([left, { ...right, mode: 'subtract' }], W, H))).toBeCloseTo(0.4 * W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([left, { ...right, mode: 'intersect' }], W, H))).toBeCloseTo(0.2 * W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([{ ...left, mode: 'subtract' }], W, H))).toBeCloseTo(0.4 * W * H, -1)
  })

  it('不透明度、反转、扩展、羽化', () => {
    const base: VideoEditMaskShape = { id: 'b', kind: 'rect', box: [0.25, 0.25, 0.5, 0.5], feather: 0 }
    expect(rasterizeVideoEditMaskShapes([{ ...base, opacity: 50 }], W, H)[50 * W + 100]).toBe(128)
    const inverted = rasterizeVideoEditMaskShapes([{ ...base, invert: true }], W, H)
    expect(inverted[50 * W + 100]).toBe(0); expect(inverted[0]).toBe(255)
    // 扩展 100 = 画面高度 10% = 10 像素
    expect(coverage(rasterizeVideoEditMaskShapes([{ ...base, expand: 100 }], W, H))).toBeCloseTo(120 * 70, -2)
    const feathered = rasterizeVideoEditMaskShapes([{ ...base, feather: 60 }], W, H)
    expect(feathered[50 * W + 50]).toBeGreaterThan(40); expect(feathered[50 * W + 50]).toBeLessThan(215)
    expect(feathered[50 * W + 100]).toBe(255)
  })

  it('钢笔：尖角折线与带控制柄的曲线；自交路径按非零环绕填充', () => {
    const triangle = flattenVideoEditMaskPath([[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]], 10, 10)
    expect(Array.from(triangle)).toEqual([0, 0, 10, 0, 0, 10])
    expect(coverage(fillVideoEditMaskPolygon(triangle, 10, 10))).toBeCloseTo(50, 0)
    const curved = flattenVideoEditMaskPath([[0.5, 0, 0.3, 0, 0.3, 0], [1, 1, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]], 10, 10)
    expect(curved.length).toBeGreaterThan(6)
  })
})

describe('作用区域：编辑与变换', () => {
  it('拖角：对角固定；拖动整体：所有顶点平移；拖控制柄：另一侧共线反向', () => {
    const rect: VideoEditMaskShape = { id: 'r', kind: 'rect', box: [0.2, 0.2, 0.4, 0.4] }
    expect(editVideoEditMaskShape(rect, 'corner', 2, 0, 0, { u: 0.9, v: 0.7 }).box).toEqual([0.2, 0.2, 0.7, expect.closeTo(0.5)])
    expect(editVideoEditMaskShape(rect, 'corner', 0, 0, 0, { u: 0.9, v: 0.1 }).box).toEqual([expect.closeTo(0.6), 0.1, expect.closeTo(0.3), expect.closeTo(0.5)])
    const path: VideoEditMaskShape = { id: 'p', kind: 'path', points: [[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]] }
    expect(editVideoEditMaskShape(path, 'move', 0, 0.1, 0.2, { u: 0, v: 0 }).points![1]).toEqual([1.1, 0.2, 0, 0, 0, 0])
    expect(editVideoEditMaskShape(path, 'out', 1, 0, 0, { u: 1.2, v: 0.1 }).points![1]).toEqual([1, 0, expect.closeTo(-0.2), expect.closeTo(-0.1), expect.closeTo(0.2), expect.closeTo(0.1)])
  })

  it('按中心缩放平移（遮罩跟随用）：框与控制柄一起变', () => {
    const moved = transformVideoEditMaskShape({ id: 'e', kind: 'ellipse', box: [0.4, 0.4, 0.2, 0.2] }, { fromX: 0.5, fromY: 0.5, toX: 0.6, toY: 0.5, scale: 2 })
    expect(moved.box).toEqual([expect.closeTo(0.4), expect.closeTo(0.3), 0.4, 0.4])
    expect(videoEditMaskShapePoints(moved)).toHaveLength(4)
    const bounds = videoEditMaskShapeBounds({ kind: 'path', points: [[0.1, 0.2, 0, 0, 0, 0], [0.5, 0.2, 0, 0, 0, 0], [0.3, 0.6, 0, 0, 0, 0]] })
    expect(bounds.map(value => Math.round(value * 100) / 100)).toEqual([0.1, 0.2, 0.4, 0.4])
  })
})
