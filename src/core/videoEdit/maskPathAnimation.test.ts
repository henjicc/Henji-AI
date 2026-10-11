import { expect, it } from 'vitest'
import { createVideoEditMaskShape, insertVideoEditMaskPoint, editVideoEditMaskShape, videoEditMaskShapeSchema } from './effectMasks'
import { evaluateVideoEditMaskPath, videoEditMaskPathAnimationSchema } from './maskPathAnimation'

it('formal schema rejects topology and midpoint collapse; native evaluator holds exact keys', () => {
  const shape = createVideoEditMaskShape('rect', 's')
  const pathAnimation = { pointIds: ['a', 'b', 'c', 'd'], keys: [{ sourceTimeUs: 0, points: shape.points, interpolation: 'hold' as const }, { sourceTimeUs: 1e6, points: shape.points.map(p => [p[0] + .1, ...p.slice(1)] as typeof p), interpolation: 'linear' as const }] }
  const parsed = videoEditMaskShapeSchema.parse({ ...shape, pathAnimation })
  expect(evaluateVideoEditMaskPath(parsed, 999999).points).toEqual(shape.points)
  expect(evaluateVideoEditMaskPath(parsed, 1e6).points).toEqual(pathAnimation.keys[1].points)
  expect(() => videoEditMaskPathAnimationSchema.parse({ ...pathAnimation, pointIds: ['a', 'a', 'c', 'd'] })).toThrow()
  expect(() => videoEditMaskShapeSchema.parse({ ...parsed, points: shape.points.slice(1) })).toThrow()
  const rotated = shape.points.map(p => [1 - p[0], 1 - p[1], 0, 0, 0, 0] as typeof p)
  expect(() => videoEditMaskPathAnimationSchema.parse({ ...pathAnimation, keys: [pathAnimation.keys[0], { ...pathAnimation.keys[1], points: rotated }] })).toThrow('退化')
  expect(() => insertVideoEditMaskPoint(parsed, 0, .5)).toThrow('关键帧')
  expect(() => editVideoEditMaskShape(parsed, 'move', 0, .1, 0, { u: 0, v: 0 })).toThrow('关键帧')
})
