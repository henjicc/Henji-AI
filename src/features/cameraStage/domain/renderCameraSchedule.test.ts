import { describe, expect, it } from 'vitest'
import { buildRenderCameraSchedule, normalizeCameraCuts, resolveRenderCameraAt } from './renderCameraSchedule'

describe('buildRenderCameraSchedule / resolveRenderCameraAt', () => {
  it('没有切换点返回空表，查询回退 null', () => {
    const schedule = buildRenderCameraSchedule([], 'fallback-camera')
    expect(schedule).toEqual([])
    expect(resolveRenderCameraAt(schedule, 0)).toBeNull()
  })

  it('第一个切换点之前与 null 切换点用活动摄像机，切换点时刻归属后一段', () => {
    const schedule = buildRenderCameraSchedule([
      { id: 'b', time: 3, cameraId: 'camera-b' },
      { id: 'a', time: 1, cameraId: 'camera-a' },
      { id: 'back', time: 5, cameraId: null },
    ], 'active')
    expect(resolveRenderCameraAt(schedule, 0.5)).toBe('active')
    expect(resolveRenderCameraAt(schedule, 1)).toBe('camera-a')
    expect(resolveRenderCameraAt(schedule, 2.99)).toBe('camera-a')
    expect(resolveRenderCameraAt(schedule, 3)).toBe('camera-b')
    expect(resolveRenderCameraAt(schedule, 999)).toBe('active')
  })

  it('读文件时丢掉坏切换点、同一时刻只留最后一条', () => {
    expect(normalizeCameraCuts([
      { id: 'x', time: 2, cameraId: 'a' }, { time: -1, cameraId: 'a' }, null, { id: 'y', time: 2, cameraId: 'b' }, { id: 'z', time: 0, cameraId: '' },
    ])).toEqual([{ id: 'z', time: 0, cameraId: null }, { id: 'y', time: 2, cameraId: 'b' }])
  })
})
