import { describe, expect, it } from 'vitest'
import type { StageVec3 } from './sceneTypes'
import { compileCameraMoveSamples } from './shotCameraMovePresets'

function distance(a: StageVec3, b: StageVec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

/** 水平面（XZ）内相对 center 的角度，角度制 */
function horizontalAngleDeg(v: StageVec3, center: StageVec3): number {
  return (Math.atan2(v.z - center.z, v.x - center.x) * 180) / Math.PI
}

describe('compileCameraMoveSamples', () => {
  describe('orbit 环绕', () => {
    const target: StageVec3 = { x: 0, y: 0, z: 0 }
    const fromPosition: StageVec3 = { x: 0, y: 2, z: 5 }

    it('180° 环绕：全程到目标距离恒定（半径不变），起终角度差 180°', () => {
      const samples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 180, direction: 'cw' },
        fromPosition,
        target,
        0,
        10,
        'linear',
      )
      const startDistance = distance(fromPosition, target)
      for (const sample of samples) {
        expect(distance(sample.position, target)).toBeCloseTo(startDistance, 5)
        expect(sample.position.y).toBeCloseTo(fromPosition.y, 5)
      }

      const startAngle = horizontalAngleDeg(fromPosition, target)
      const endAngle = horizontalAngleDeg(samples[samples.length - 1].position, target)
      let diff = Math.abs(endAngle - startAngle) % 360
      if (diff > 180) diff = 360 - diff
      expect(diff).toBeCloseTo(180, 3)
    })

    it('每 ~15° 一个采样点：180° 应产生 13 个点（12 段线性近似）', () => {
      const samples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 180, direction: 'cw' },
        fromPosition,
        target,
        0,
        10,
        'linear',
      )
      expect(samples.length).toBe(13)
    })

    it('cw 与 ccw 方向相反：90° 环绕终点角度变化符号相反', () => {
      const cwSamples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 90, direction: 'cw' },
        fromPosition,
        target,
        0,
        10,
        'linear',
      )
      const ccwSamples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 90, direction: 'ccw' },
        fromPosition,
        target,
        0,
        10,
        'linear',
      )
      const startAngle = horizontalAngleDeg(fromPosition, target)
      const cwDelta = horizontalAngleDeg(cwSamples[cwSamples.length - 1].position, target) - startAngle
      const ccwDelta = horizontalAngleDeg(ccwSamples[ccwSamples.length - 1].position, target) - startAngle

      expect(Math.abs(cwDelta)).toBeCloseTo(90, 3)
      expect(cwDelta).toBeCloseTo(-ccwDelta, 3)
    })

    it('degrees=0 时退化为原地不动（首尾两点，位置均等于起点）', () => {
      const samples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 0, direction: 'cw' },
        fromPosition,
        target,
        2,
        6,
        'easeInOut',
      )
      expect(samples).toHaveLength(2)
      expect(samples[0].position).toEqual(fromPosition)
      expect(samples[1].position).toEqual(fromPosition)
    })
  })

  describe('dollyIn / dollyOut 推近拉远', () => {
    const fromPosition: StageVec3 = { x: 0, y: 1, z: 10 }
    const target: StageVec3 = { x: 0, y: 1, z: 0 }

    it('dollyIn distanceRatio=0.5：终点在起点→目标连线的中点', () => {
      const samples = compileCameraMoveSamples({ kind: 'dollyIn', distanceRatio: 0.5 }, fromPosition, target, 0, 4, 'easeInOut')
      expect(samples).toHaveLength(2)
      expect(samples[0].position).toEqual(fromPosition)
      expect(samples[1].position).toEqual({ x: 0, y: 1, z: 5 })
    })

    it('dollyOut distanceRatio=2：终点到目标距离是起点的两倍', () => {
      const samples = compileCameraMoveSamples({ kind: 'dollyOut', distanceRatio: 2 }, fromPosition, target, 0, 4, 'linear')
      expect(distance(samples[1].position, target)).toBeCloseTo(distance(fromPosition, target) * 2, 5)
    })
  })

  describe('truck 横移', () => {
    it('横移终点垂直于水平视线方向，位移量等于 offset', () => {
      const fromPosition: StageVec3 = { x: 0, y: 1, z: 0 }
      const target: StageVec3 = { x: 0, y: 1, z: 10 }
      const samples = compileCameraMoveSamples({ kind: 'truck', offset: 3 }, fromPosition, target, 0, 4, 'linear')
      const moved = samples[1].position
      expect(moved.z).toBeCloseTo(fromPosition.z, 5)
      expect(moved.y).toBeCloseTo(fromPosition.y, 5)
      expect(Math.abs(moved.x - fromPosition.x)).toBeCloseTo(3, 5)
    })
  })

  describe('crane 升降', () => {
    it('升降沿世界 Y 轴移动 height，X/Z 不变', () => {
      const fromPosition: StageVec3 = { x: 1, y: 2, z: 3 }
      const target: StageVec3 = { x: 0, y: 0, z: 0 }
      const samples = compileCameraMoveSamples({ kind: 'crane', height: 1.5 }, fromPosition, target, 0, 4, 'linear')
      expect(samples[1].position).toEqual({ x: 1, y: 3.5, z: 3 })
    })
  })

  describe('时间重映射（缓动反解）', () => {
    const fromPosition: StageVec3 = { x: 0, y: 0, z: 5 }
    const target: StageVec3 = { x: 0, y: 0, z: 0 }

    it('easeInOut 下中段采样点时间间隔小于两端（速度中段更快、耗时更短）', () => {
      const samples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 180, direction: 'cw' },
        fromPosition,
        target,
        0,
        10,
        'easeInOut',
      )
      const firstGap = samples[1].time - samples[0].time
      const midIndex = Math.floor(samples.length / 2)
      const midGap = samples[midIndex + 1].time - samples[midIndex].time
      expect(midGap).toBeLessThan(firstGap)
    })

    it('linear 下所有采样点时间间隔均匀', () => {
      const samples = compileCameraMoveSamples(
        { kind: 'orbit', degrees: 180, direction: 'cw' },
        fromPosition,
        target,
        0,
        10,
        'linear',
      )
      const gaps = samples.slice(1).map((sample, index) => sample.time - samples[index].time)
      for (const gap of gaps) {
        expect(gap).toBeCloseTo(gaps[0], 5)
      }
    })
  })
})
