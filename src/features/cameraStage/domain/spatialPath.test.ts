import { describe, expect, it } from 'vitest'
import {
  createCameraPresetPath,
  cubicSpatialPoint,
  defaultSpatialPath,
  markSpatialPathCustom,
  sampleSpatialMotion,
} from './spatialPath'

describe('分段空间路径', () => {
  it('默认贝塞尔保持原直线且使用三等分手柄', () => {
    const from = { x: 0, y: 0, z: 0 }
    const to = { x: 6, y: 3, z: -3 }
    const path = defaultSpatialPath(from, to)
    expect(path.startOutTangent).toEqual({ x: 2, y: 1, z: -1 })
    expect(path.endInTangent).toEqual({ x: -2, y: -1, z: 1 })
    const midpoint = cubicSpatialPoint(from, to, path, 0.5)
    expect(midpoint.x).toBeCloseTo(3, 8)
    expect(midpoint.y).toBeCloseTo(1.5, 8)
    expect(midpoint.z).toBeCloseTo(-1.5, 8)
  })

  it.each([
    [90, 0],
    [180, 1],
    [360, 3],
  ])('%d° 环绕按每段不超过 90° 自动生成节点', (degrees, knotCount) => {
    const from = { x: 0, y: 2, z: 5 }
    const target = { x: 0, y: 0, z: 0 }
    const generated = createCameraPresetPath({ kind: 'orbit', degrees, direction: 'cw' }, from, target)
    expect(generated.path.knots).toHaveLength(knotCount)
    for (let index = 0; index <= 20; index += 1) {
      const point = cubicSpatialPoint(from, generated.endPosition, generated.path, index / 20)
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(5, 2)
      expect(point.y).toBeCloseTo(2, 5)
    }
  })

  it('直线预设计算终点并生成可编辑单段路径', () => {
    const from = { x: 0, y: 2, z: 6 }
    const target = { x: 0, y: 2, z: 0 }
    const dolly = createCameraPresetPath({ kind: 'dollyIn', distanceRatio: 0.5 }, from, target)
    const truck = createCameraPresetPath({ kind: 'truck', offset: 2 }, from, target)
    const crane = createCameraPresetPath({ kind: 'crane', height: 3 }, from, target)
    expect(dolly.endPosition).toEqual({ x: 0, y: 2, z: 3 })
    expect(truck.endPosition).toEqual({ x: 2, y: 2, z: 6 })
    expect(crane.endPosition).toEqual({ x: 0, y: 5, z: 6 })
    expect(dolly.path.knots).toEqual([])
  })

  it('按弧长采样后匀速点距保持稳定且落在圆上，手动编辑会转为自定义来源', () => {
    const from = { x: 0, y: 2, z: 5 }
    const generated = createCameraPresetPath(
      { kind: 'orbit', degrees: 180, direction: 'cw' },
      from,
      { x: 0, y: 0, z: 0 },
    )
    const motion = {
      objectId: 'camera',
      segments: [{ startTime: 0, endTime: 2, from, to: generated.endPosition, path: generated.path, easing: 'linear' as const }],
    }
    const samples = Array.from({ length: 121 }, (_, index) => sampleSpatialMotion(motion, index / 60)!)
    const distances = samples.slice(1).map((sample, index) => Math.hypot(
      sample.x - samples[index].x,
      sample.y - samples[index].y,
      sample.z - samples[index].z,
    ))
    // 运行时按弧长取点，不再是折线烤点：逐帧点距（即速度）几乎恒定，没有分段台阶。
    expect((Math.max(...distances) - Math.min(...distances)) / Math.max(...distances)).toBeLessThan(0.005)
    for (const sample of samples) expect(Math.hypot(sample.x, sample.z)).toBeCloseTo(5, 2)
    expect(sampleSpatialMotion(motion, 2.01)).toBeUndefined()
    expect(markSpatialPathCustom(generated.path).source).toEqual({
      kind: 'custom',
      originPreset: { kind: 'orbit', degrees: 180, direction: 'cw' },
    })
  })
})
