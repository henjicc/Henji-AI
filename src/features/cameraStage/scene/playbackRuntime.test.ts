import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  advanceCameraStagePlaybackRuntime,
  claimCameraStagePlaybackDriver,
  pauseCameraStagePlaybackRuntime,
  readCameraStagePlaybackRuntime,
  releaseCameraStagePlaybackDriver,
  resumeCameraStagePlaybackDriver,
  resetCameraStagePlaybackRuntimeForTest,
  resetCameraStagePlaybackRuntime,
  seekCameraStagePlaybackRuntime,
  subscribeCameraStagePlaybackRuntime,
} from './playbackRuntime'

describe('cameraStage playback runtime', () => {
  beforeEach(() => resetCameraStagePlaybackRuntimeForTest())

  it('只接受当前会话 driver，重挂后旧 driver 不能重复推进', () => {
    const first = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0, playing: true })
    const second = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0, playing: true })

    expect(advanceCameraStagePlaybackRuntime({ driver: first, delta: 0.1, duration: 2, loop: false }).accepted)
      .toBe(false)
    expect(advanceCameraStagePlaybackRuntime({ driver: second, delta: 0.1, duration: 2, loop: false }))
      .toMatchObject({ accepted: true, time: 0.1 })
    releaseCameraStagePlaybackDriver(first)
    expect(advanceCameraStagePlaybackRuntime({ driver: second, delta: 0.1, duration: 2, loop: false }).time)
      .toBeCloseTo(0.2)
  })

  it('循环、seek 和 pause 都发布同一条精确时间线', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCameraStagePlaybackRuntime(listener)
    const driver = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0.95, playing: true })

    expect(advanceCameraStagePlaybackRuntime({ driver, delta: 0.1, duration: 1, loop: true }))
      .toMatchObject({ time: expect.closeTo(0.05), wrapped: true, reachedEnd: false })
    seekCameraStagePlaybackRuntime(0.4, true)
    pauseCameraStagePlaybackRuntime(0.4)
    expect(readCameraStagePlaybackRuntime()).toMatchObject({ time: 0.4, playing: false, reason: 'pause' })
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    seekCameraStagePlaybackRuntime(0.8)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('切换工程会重置 runtime，上一会话 driver 随即失效', () => {
    const previous = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 1, playing: true })
    resetCameraStagePlaybackRuntime(0.25, 'scene-b')
    expect(resumeCameraStagePlaybackDriver(previous, 'scene-a')).toBe(false)
    expect(resumeCameraStagePlaybackDriver(previous, 'scene-b')).toBe(false)
    expect(advanceCameraStagePlaybackRuntime({ driver: previous, delta: 0.2, duration: 2, loop: false }).accepted)
      .toBe(false)
    const current = claimCameraStagePlaybackDriver({ sessionKey: 'scene-b', time: 0.25, playing: false })

    expect(readCameraStagePlaybackRuntime()).toMatchObject({ time: 0.25, playing: false, reason: 'reset' })
    expect(advanceCameraStagePlaybackRuntime({ driver: current, delta: 0.2, duration: 2, loop: false }).accepted)
      .toBe(true)
  })

  it('同一工程重载后允许已挂载 driver 恢复租约', () => {
    const driver = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0.4, playing: true })
    resetCameraStagePlaybackRuntime(0, 'scene-a')

    expect(resumeCameraStagePlaybackDriver(driver, 'scene-a')).toBe(true)
    expect(advanceCameraStagePlaybackRuntime({ driver, delta: 0.1, duration: 2, loop: false }))
      .toMatchObject({ accepted: true, time: 0.1 })
  })

  it('重置后新 driver 会永久撤销同工程旧 token', () => {
    const previous = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0, playing: true })
    resetCameraStagePlaybackRuntime(0, 'scene-a')
    const current = claimCameraStagePlaybackDriver({ sessionKey: 'scene-a', time: 0, playing: true })
    releaseCameraStagePlaybackDriver(current)

    expect(resumeCameraStagePlaybackDriver(previous, 'scene-a')).toBe(false)
    expect(advanceCameraStagePlaybackRuntime({ driver: previous, delta: 0.1, duration: 1, loop: false }).accepted)
      .toBe(false)
  })
})
