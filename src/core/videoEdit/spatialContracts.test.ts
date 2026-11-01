import { describe, expect, it } from 'vitest'
import { spatialCameraSchema, spatialClipSchema } from './spatialSchema'
import { evaluateVideoEditKeyframes, sliceVideoEditCurves } from './keyframes'
import { spatialMultiply, spatialProjection, spatialRotation, spatialTransform, spatialView } from './spatialMatrices'

describe('空间坐标与曲线契约', () => {
  it.each([[1920, 1080], [1440 * 4 / 3, 1080], [1080, 1920]])('零相机保持显示画幅 %s × %s 的参考平面', (width, height) => {
    const aspect = width / height; const distance = 80 * aspect / 36
    const { view } = spatialView([0, 0, distance], [0, 0, 0])
    for (const gpu of [true, false]) {
      const matrix = spatialMultiply(spatialProjection(aspect, distance, .01, 1000, gpu), view)
      const topLeft = spatialTransform(matrix, [-aspect / 2, .5, 0])
      expect(topLeft[0]).toBeCloseTo(-1, 13); expect(topLeft[1]).toBeCloseTo(1, 13)
      expect(spatialTransform(matrix, [0, 0, 0]).slice(0, 2)).toEqual([0, 0])
    }
  })
  it('依次 X→Y→屏幕顺时针 Z，非交换旋转不依赖 Euler 默认顺序', () => {
    const actual = spatialTransform(spatialRotation(90, 90, 90), [1, 2, 3])
    actual.forEach((value, index) => expect(value).toBeCloseTo([-3, -2, -1][index], 13))
  })
  it('lookAt 极点回退与调用历史无关，重合目标明确失败', () => {
    const first = spatialView([0, 1, 0], [0, 0, 0])
    spatialView([7, 3, 1], [0, 2, 0])
    expect(spatialView([0, 1, 0], [0, 0, 0])).toEqual(first)
    expect(() => spatialView([0, 0, 0], [0, 0, 0])).toThrow('重合')
  })
  it('缺省不补写零值；相机目标 hold 与数值 Bezier 分离，切片保留子帧值', () => {
    expect(spatialClipSchema.parse({})).toEqual({})
    expect(spatialCameraSchema.parse({})).toEqual({})
    const camera = spatialCameraSchema.parse({ curves: { perspective: [
      { time: 0, value: 0, interpolation: 'bezier', bezier: [.2, .1, .8, .9] },
      { time: 20, value: 2, interpolation: 'linear' },
    ] }, bindings: { aim: [{ time: 7, value: { kind: 'clip', clipId: 'subject' }, interpolation: 'hold' }, { time: 12, value: null, interpolation: 'hold' }] } })
    const sliced = sliceVideoEditCurves(camera.curves, 4, 10)!
    for (const time of [0, .25, 4.5, 9]) expect(evaluateVideoEditKeyframes(sliced.perspective, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(camera.curves!.perspective, time + 4, 0), 10)
    expect(spatialCameraSchema.safeParse({ curves: { focusDistance: [{ time: 0, value: 'clip', interpolation: 'hold' }] } }).success).toBe(false)
  })
})
