import { expect, it } from 'vitest'
import { encodeLumetriCurve, lumetriCurveLut, lumetriCurvePoints, lumetriSpline, parseLumetriCurve } from './lumetriCurves'
import { normalizeVideoEditBuiltinParams } from './builtinEffects'
import { assertVideoEditBuiltinCurves, evaluateVideoEditBuiltinParameters } from './keyframes'
it('不等间隔单调样条保持单调、经过锚点、平台不超调；下降和局部极值有界', () => {
  for (const values of [[0, 1, 80, 80, 100], [100, 99, 20, 20, 0], [0, 90, 10, 60, 20]]) {
    const points = [0, 2, 30, 60, 100].map((x, i) => ({ x, y: values[i] })); const evaluate = lumetriSpline(points)
    points.forEach(point => expect(evaluate(point.x)).toBeCloseTo(point.y, 8))
    for (let i = 0; i < points.length - 1; i++) { let previous = evaluate(points[i].x); for (let k = 1; k <= 100; k++) { const next = evaluate(points[i].x + (points[i + 1].x - points[i].x) * k / 100); expect(next).toBeGreaterThanOrEqual(Math.min(values[i], values[i + 1]) - 1e-9); expect(next).toBeLessThanOrEqual(Math.max(values[i], values[i + 1]) + 1e-9); if (values[i + 1] >= values[i]) expect(next).toBeGreaterThanOrEqual(previous - 1e-9); else expect(next).toBeLessThanOrEqual(previous + 1e-9); previous = next } }
  }
})
it('旧五点及其数值关键帧自动迁移；新控制点优先，hold动画兼容', () => {
  const builtin = { id: 'lumetri_color', params: { curve_master_2: 50 }, curves: { curve_master_2: [{ time: 0, value: 50, interpolation: 'linear' as const }, { time: 10, value: 90, interpolation: 'linear' as const }] } }
  const values = evaluateVideoEditBuiltinParameters(builtin, 5)
  expect(lumetriCurvePoints(values, 'master')[2]).toEqual({ x: 50, y: 70 })
  const points = [{ x: 0, y: 10 }, { x: 41, y: 65 }, { x: 100, y: 90 }]
  expect(lumetriCurvePoints({ ...values, curve_master_points: encodeLumetriCurve(points) }, 'master')).toEqual(points)
  const lut = lumetriCurveLut(points); expect(lut[0]).toBeCloseTo(.1); expect(lut[1023]).toBeCloseTo(.9)
  expect(() => assertVideoEditBuiltinCurves({ id: 'lumetri_color', curves: { curve_master_points: [{ time: 0, value: encodeLumetriCurve(points), interpolation: 'linear' }] } })).toThrow('hold')
})
it('通用参数严格校验控制点和色相首尾连续', () => {
  for (const raw of ['[]', '[{"x":1,"y":1},{"x":1,"y":20}]', '[{"x":0,"y":-1},{"x":100,"y":100}]', 'null']) expect(() => parseLumetriCurve(raw)).toThrow()
  expect(() => normalizeVideoEditBuiltinParams('lumetri_color', { curve_hue_sat_points: '[{"x":0,"y":20},{"x":100,"y":80}]' })).toThrow('连续')
})
