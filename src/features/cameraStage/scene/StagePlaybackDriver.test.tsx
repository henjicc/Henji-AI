// @vitest-environment jsdom
import React from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCameraStageStore } from '../store/cameraStageStore'
import { readCameraStagePlaybackRuntime, resetCameraStagePlaybackRuntimeForTest } from './playbackRuntime'

let frameCallback: ((state: unknown, delta: number) => void) | null = null
let framePriority: number | undefined

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void, priority?: number) => {
    frameCallback = callback
    framePriority = priority
  },
}))

import StagePlaybackDriver from './StagePlaybackDriver'

describe('StagePlaybackDriver', () => {
  beforeEach(() => {
    frameCallback = null
    framePriority = undefined
    resetCameraStagePlaybackRuntimeForTest()
    useCameraStageStore.getState().newScene('播放时钟测试')
    useCameraStageStore.setState((state) => ({
      animation: { ...state.animation, duration: 1 },
      playback: { playing: false, currentTime: 29 / 30, loop: true },
    }))
  })

  it('在对象/角色之前推进 runtime，循环回绕时立即更新低频 UI 投影，卸载后不再推进', () => {
    useCameraStageStore.getState().play()
    const view = render(<StagePlaybackDriver />)
    expect(framePriority).toBe(-2)
    expect(frameCallback).not.toBeNull()

    act(() => frameCallback?.({}, 0.1))
    expect(readCameraStagePlaybackRuntime().time).toBeCloseTo(1 / 15)
    expect(useCameraStageStore.getState().playback.currentTime).toBeCloseTo(1 / 15)

    view.unmount()
    const timeAfterUnmount = readCameraStagePlaybackRuntime().time
    act(() => frameCallback?.({}, 0.1))
    expect(readCameraStagePlaybackRuntime().time).toBe(timeAfterUnmount)
  })

  it('同工程 loadSnapshot 不重挂组件也能恢复租约并继续推进', () => {
    const store = useCameraStageStore.getState()
    store.loadSnapshot({
      objects: store.objects,
      activeCameraId: store.activeCameraId,
      animation: store.animation,
      sceneSettings: store.sceneSettings,
      stateKeyframes: store.stateKeyframes,
    }, { id: 'same-project', name: '同工程' })
    const view = render(<StagePlaybackDriver />)

    const loaded = useCameraStageStore.getState()
    loaded.loadSnapshot({
      objects: loaded.objects,
      activeCameraId: loaded.activeCameraId,
      animation: loaded.animation,
      sceneSettings: loaded.sceneSettings,
      stateKeyframes: loaded.stateKeyframes,
    }, { id: 'same-project', name: '同工程重载' })
    useCameraStageStore.setState((state) => ({
      animation: { ...state.animation, duration: 1 },
    }))
    useCameraStageStore.getState().play()
    act(() => frameCallback?.({}, 0.1))

    expect(readCameraStagePlaybackRuntime()).toMatchObject({ playing: true, time: 0.1 })
    view.unmount()
  })

  it('null 到 null 的新建场景重置后，已挂载 driver 仍能继续推进', () => {
    const view = render(<StagePlaybackDriver />)
    useCameraStageStore.getState().newScene('重建空场景')
    useCameraStageStore.setState((state) => ({
      animation: { ...state.animation, duration: 1 },
    }))
    useCameraStageStore.getState().play()
    act(() => frameCallback?.({}, 0.1))

    expect(readCameraStagePlaybackRuntime()).toMatchObject({ playing: true, time: 0.1 })
    view.unmount()
  })
})
