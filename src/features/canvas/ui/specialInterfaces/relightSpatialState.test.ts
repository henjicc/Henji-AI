import { RELIGHT_KEY_DIRECTIONS, RELIGHT_RIM_DIRECTIONS } from '@/features/canvas/capabilities/relightPolicy'
import { describe, expect, it } from 'vitest'
import { imagePlaneSize, lightPosition, mainDirectionForPose, poseForMain, poseForRim,
  projectSpatialPoint, spatialPointAtPointer, rimDirectionForPose, snapLightAtPoint } from './relightSpatialState'

describe('打光三维空间', () => {
  it('球内指针连续投影回原位置，球外仅限制边界，前后半球均无离散量化', () => {
    for (const view of ['front', 'perspective'] as const) for (const depth of [-1, 1]) {
      for (const x of [50, 61.125, 61.25, 75.6]) {
        const point = spatialPointAtPointer(x, 57.123, view, depth)
        const screen = projectSpatialPoint(point, view)
        expect(screen.x).toBeCloseTo(x, 8)
        expect(screen.y).toBeCloseTo(57.123, 8)
        expect(Math.sign(screen.z)).toBe(depth)
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1)
      }
      const outside = spatialPointAtPointer(180, -150, view, depth)
      expect(Math.hypot(outside.x, outside.y, outside.z)).toBeCloseTo(1)
    }
  })
  it('所有有效灯位在两种视图中均能命中自身，主光在前、轮廓光在后', () => {
    for (const view of ['front', 'perspective'] as const) {
      for (const direction of RELIGHT_KEY_DIRECTIONS) {
        const pose = poseForMain(direction)
        const point = projectSpatialPoint(lightPosition(pose), view)
        const snapped = snapLightAtPoint(point.x, point.y, 'main', view)
        expect(mainDirectionForPose(snapped)).toBe(direction)
        expect(snapped).toEqual(pose)
        expect(lightPosition(snapped).z).toBeGreaterThan(0)
      }
      for (const direction of RELIGHT_RIM_DIRECTIONS.filter(value => value !== 'off')) {
        const pose = poseForRim(direction)
        const point = projectSpatialPoint(lightPosition(pose), view)
        const snapped = snapLightAtPoint(point.x, point.y, 'rim', view)
        expect(rimDirectionForPose(snapped)).toBe(direction)
        expect(lightPosition(snapped).z).toBeLessThan(0)
      }
    }
  })
  it('相同平面坐标的前后灯，在正面重叠、透视下分开；图片平面与灯共用相机', () => {
    const front = { x: 0.3, y: 0.2, z: 0.8 }
    const back = { ...front, z: -0.8 }
    expect(projectSpatialPoint(front, 'front').x).toBe(projectSpatialPoint(back, 'front').x)
    expect(projectSpatialPoint(front, 'perspective').x).toBeLessThan(projectSpatialPoint(back, 'perspective').x)
    expect(projectSpatialPoint({ x: 0, y: 0, z: 0 }, 'perspective')).toEqual({ x: 50, y: 50, z: 0 })
  })
  it('竖图横图均按自身比例生成平面，没有固定比例的边框填充', () => {
    for (const aspect of [0.5, 1, 2, 4]) {
      const size = imagePlaneSize(aspect)
      expect(size.width / size.height).toBeCloseTo(aspect)
      expect(Math.max(size.width, size.height)).toBe(0.88)
    }
  })
})
