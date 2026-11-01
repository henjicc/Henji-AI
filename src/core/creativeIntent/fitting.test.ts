import { expect, it } from 'vitest'
import { fitScalarCurve, scalarError } from './fitting'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'

it('空间运动的非线性子帧参考细分到单帧，不能提前退化为连接整数点的折线', () => {
  const reference = (time: number): number => {
    const u = time / 20, p = u * u * (3 - 2 * u)
    return (Math.exp(.3 * p) - 1) * (1 - p)
  }
  const samples = Array.from({ length: 21 }, (_, time) => ({ time, value: reference(time), hard: time === 0 || time === 20 }))
  const tolerance = .000005
  const fitted = fitScalarCurve(samples, tolerance, {}, reference)
  const probes = Array.from({ length: 81 }, (_, index) => ({ time: index / 4, value: reference(index / 4), hard: false }))
  expect(scalarError(probes, fitted.points, false).maxError).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(evaluateVideoEditKeyframes(fitted.points, .25, 0) - reference(.25))).toBeLessThanOrEqual(tolerance)
})
