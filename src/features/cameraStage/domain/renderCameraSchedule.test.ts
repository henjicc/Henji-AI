import { describe, expect, it } from 'vitest'
import { createStateKeyframe } from './stateKeyframeTypes'
import { buildRenderCameraSchedule, resolveRenderCameraAt } from './renderCameraSchedule'

describe('buildRenderCameraSchedule / resolveRenderCameraAt', () => {
  it('空状态关键帧数组返回空表，查询回退 null', () => {
    const schedule = buildRenderCameraSchedule([], 'fallback-camera')
    expect(schedule).toEqual([])
    expect(resolveRenderCameraAt(schedule, 0)).toBeNull()
  })

  it('未指定机位的卡沿用 fallbackCameraId（旧工程/单机位工程行为不变）', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1')
    const stateKeyframeB = createStateKeyframe([], '卡2')
    stateKeyframeA.hold = 1
    stateKeyframeA.transitionDuration = 1
    stateKeyframeB.hold = 1
    const schedule = buildRenderCameraSchedule([stateKeyframeA, stateKeyframeB], 'camera-fallback')
    expect(schedule.every((entry) => entry.cameraId === 'camera-fallback')).toBe(true)
  })

  it('机位不同的相邻卡在区间末端（下一卡静止段起点）切换渲染机位', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-b')
    stateKeyframeA.hold = 1
    stateKeyframeA.transitionDuration = 2 // 区间时长保留，硬切发生在区间末端（编译层 hold 缓动）
    stateKeyframeB.hold = 1
    const schedule = buildRenderCameraSchedule([stateKeyframeA, stateKeyframeB], null)

    // A 段：[0, 3)（含硬切前的整段区间）；B 段：[3, 4)，切换点与画面跳变点（区间末端）重合
    expect(schedule).toEqual([
      { startTime: 0, endTime: 3, cameraId: 'camera-a' },
      { startTime: 3, endTime: 4, cameraId: 'camera-b' },
    ])
    expect(resolveRenderCameraAt(schedule, 0)).toBe('camera-a')
    expect(resolveRenderCameraAt(schedule, 2.99)).toBe('camera-a')
    expect(resolveRenderCameraAt(schedule, 3)).toBe('camera-b')
    expect(resolveRenderCameraAt(schedule, 3.5)).toBe('camera-b')
  })

  it('同机位相邻卡保留真实过渡时长，过渡段整体归属前一卡机位', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-a')
    stateKeyframeA.hold = 1
    stateKeyframeA.transitionDuration = 2
    stateKeyframeB.hold = 1
    const schedule = buildRenderCameraSchedule([stateKeyframeA, stateKeyframeB], null)

    expect(schedule).toEqual([
      { startTime: 0, endTime: 3, cameraId: 'camera-a' },
      { startTime: 3, endTime: 4, cameraId: 'camera-a' },
    ])
  })

  it('查询越界钳制到首段/尾段', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-b')
    stateKeyframeA.hold = 1
    stateKeyframeA.transitionDuration = 1
    stateKeyframeB.hold = 1
    const schedule = buildRenderCameraSchedule([stateKeyframeA, stateKeyframeB], null)

    expect(resolveRenderCameraAt(schedule, -5)).toBe('camera-a')
    expect(resolveRenderCameraAt(schedule, 999)).toBe('camera-b')
  })

  it('机位不同不再压缩布点区间：切换只影响切换时刻的归属，原始数据不被改写', () => {
    const stateKeyframeA = createStateKeyframe([], '卡1', 'camera-a')
    const stateKeyframeB = createStateKeyframe([], '卡2', 'camera-b')
    stateKeyframeA.hold = 1
    stateKeyframeA.transitionDuration = 2
    stateKeyframeB.hold = 1

    const diffSchedule = buildRenderCameraSchedule([stateKeyframeA, stateKeyframeB], null)
    expect(diffSchedule[0].endTime).toBe(3) // 区间时长保留，硬切在区间末端

    const sameStateKeyframeB = { ...stateKeyframeB, cameraId: 'camera-a' }
    const sameSchedule = buildRenderCameraSchedule([stateKeyframeA, sameStateKeyframeB], null)
    expect(sameSchedule[0].endTime).toBe(3) // 机位相同布点完全一致
    expect(stateKeyframeA.transitionDuration).toBe(2) // 原始数据全程未被改写
  })
})
