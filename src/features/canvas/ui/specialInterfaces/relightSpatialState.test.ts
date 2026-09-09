import { describe, expect, it } from 'vitest'
import { dragLightPose, imagePlaneSize, lightPosition, mainDirectionForPose, poseForMain, poseForRim,
  projectSpatialPoint, readSpatialState, rimDirectionForPose } from './relightSpatialState'

describe('打光三维空间', () => {
  it('两盏灯均能绕到图片前后，绕行保持球面半径', () => {
    for (const pose of [poseForMain('right'), poseForRim('top-left')]) {
      const before = lightPosition(pose)
      const after = lightPosition(dragLightPose(pose, 0.5, 0))
      expect(before.z * after.z).toBeLessThan(0)
      expect(Math.hypot(after.x, after.y, after.z)).toBeCloseTo(1)
      expect(after.y).toBeCloseTo(before.y)
    }
  })
  it('相同平面坐标的前后灯，在正面重叠、透视下分开；图片平面与灯共用相机', () => {
    const front = { x: 0.3, y: 0.2, z: 0.8 }
    const back = { ...front, z: -0.8 }
    expect(projectSpatialPoint(front, 'front').x).toBe(projectSpatialPoint(back, 'front').x)
    expect(projectSpatialPoint(front, 'perspective').x).toBeLessThan(projectSpatialPoint(back, 'perspective').x)
    expect(projectSpatialPoint({ x: 0, y: 0, z: 0 }, 'perspective')).toEqual({ x: 50, y: 50, z: 0 })
  })
  it('视图元数据保留真实灯位，损坏数据回退；请求仍映射已有合法方向', () => {
    const state = { main: dragLightPose(poseForMain('right'), 0.08, 0.1), rim: poseForRim('top-left') }
    expect(readSpatialState(JSON.parse(JSON.stringify(state)), 'right', 'top-left')).toEqual(state)
    expect(mainDirectionForPose(state.main)).toBe('right')
    expect(rimDirectionForPose(state.rim)).toBe('top-left')
    expect(readSpatialState({ main: { azimuth: NaN }, rim: null }, 'top', 'off').main).toEqual(poseForMain('top'))
  })
  it('竖图横图均按自身比例生成平面，没有固定比例的边框填充', () => {
    for (const aspect of [0.5, 1, 2, 4]) {
      const size = imagePlaneSize(aspect)
      expect(size.width / size.height).toBeCloseTo(aspect)
      expect(Math.max(size.width, size.height)).toBe(0.88)
    }
  })
})
