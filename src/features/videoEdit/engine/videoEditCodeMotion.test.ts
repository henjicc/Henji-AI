import { expect, it } from 'vitest'
import { CODE_MOTION_UNIFORM_BYTES, prepareCodeMotion } from './videoEditCodeMotion'
import { CODE_IDENTITY } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'

const source = { x: -2, y: -2, width: 12, height: 12 }
const sample = (x: number, weight = 1): CodeMotionSample => ({ offset: { numerator: 0, denominator: 1 }, weight, pose: { matrix: [1, 0, 0, 1, x, 16], opacity: .5 } })

it('运动uniform使用逆矩阵、预乘权重与父级局部原点，包围盒裁到目标尺寸', () => {
  const result = prepareCodeMotion(source, [1, 0, 0, 1, -5, 0], [sample(8)], 64, 64)!
  expect(result.bounds).toEqual({ x: 1, y: 14, width: 12, height: 12 })
  expect(result.data.byteLength).toBe(CODE_MOTION_UNIFORM_BYTES)
  expect([...result.data.slice(0, 12)]).toEqual([12, 12, 1, 14, -2, -2, 12, 12, 1, 0, 0, 0])
  expect(result.data[12]).toBe(1)
  expect(result.data[14]).toBe(-3)
  expect(result.data[15]).toBe(.5)
  expect(result.data[17]).toBe(1)
  expect(result.data[18]).toBe(-16)
})
it('透明、奇异及画面外曝光不分配画面；空曝光保留透明语义', () => {
  const entry = sample(8)
  expect(prepareCodeMotion(source, CODE_IDENTITY, [], 64, 64)).toBeUndefined()
  expect(prepareCodeMotion(source, CODE_IDENTITY, [{ ...entry, pose: null }], 64, 64)).toBeUndefined()
  expect(prepareCodeMotion(source, CODE_IDENTITY, [{ ...entry, pose: { matrix: [0, 0, 0, 0, 0, 0], opacity: 1 } }], 64, 64)).toBeUndefined()
  expect(prepareCodeMotion(source, CODE_IDENTITY, [sample(200)], 64, 64)).toBeUndefined()
})
it('像素采样预算沿实际可见包围盒计费，分层共享余量并在分配前拒绝超额', () => {
  const first = prepareCodeMotion(source, CODE_IDENTITY, [sample(8)], 64, 64, 288)!
  expect(first.pixelSamples).toBe(144)
  expect(prepareCodeMotion(source, CODE_IDENTITY, [sample(8)], 64, 64, 288 - first.pixelSamples)!.pixelSamples).toBe(144)
  expect(() => prepareCodeMotion(source, CODE_IDENTITY, [sample(8)], 64, 64, 143)).toThrow('计算预算')
  // Clipping to a one-column destination costs 12 samples, not the source width.
  expect(prepareCodeMotion(source, CODE_IDENTITY, [sample(0)], 1, 64, 12)!.pixelSamples).toBe(12)
})
it('拒绝无效曝光数、权重、不透明度和非有限/超float32的逆矩阵', () => {
  const entry = sample(8)
  for (const entries of [Array.from({ length: 65 }, () => sample(8, 1 / 65)), [sample(8, -.5)], [sample(8, .5)]]) expect(() => prepareCodeMotion(source, CODE_IDENTITY, entries, 64, 64)).toThrow()
  expect(() => prepareCodeMotion(source, CODE_IDENTITY, [{ ...entry, pose: { matrix: CODE_IDENTITY, opacity: 2 } }], 64, 64)).toThrow('位姿')
  expect(() => prepareCodeMotion(source, CODE_IDENTITY, [{ ...entry, pose: { matrix: [1e-40, 0, 0, 1, 8, 16], opacity: 1 } }], 64, 64)).toThrow('浮点精度')
  expect(() => prepareCodeMotion({ ...source, width: NaN }, CODE_IDENTITY, [entry], 64, 64)).toThrow('尺寸')
})
