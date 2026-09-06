import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { clearCameraStageHistory, useCameraStageStore } from './cameraStageStore'
import {
  advanceCameraStagePlaybackRuntime,
  claimCameraStagePlaybackDriver,
  readCameraStagePlaybackRuntime,
  resetCameraStagePlaybackRuntimeForTest,
} from '../scene/playbackRuntime'

describe('3D 镜头工程快照加载', () => {
  beforeEach(() => {
    resetCameraStagePlaybackRuntimeForTest()
    useCameraStageStore.getState().newScene('测试工程')
    clearCameraStageHistory()
  })

  it('打开工程时立即显示播放头 0 秒的首关键帧画面', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    camera.transform.position.x = 99
    const first = createStateKeyframe([camera], '关键帧 1', camera.id, 0)
    first.objectStates[camera.id].transform.position.x = 3
    const second = createStateKeyframe([camera], '关键帧 2', camera.id, 2)
    second.objectStates[camera.id].transform.position.x = 12

    useCameraStageStore.getState().loadSnapshot({
      objects: [camera],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [first, second],
    }, { id: 'camera-project', name: '测试工程' })

    const state = useCameraStageStore.getState()
    expect(state.playback.currentTime).toBe(0)
    expect(state.animation.tracks.find((track) => track.objectId === camera.id && track.propertyPath === 'transform.position.x')?.keyframes)
      .toMatchObject([{ time: 0, value: 3 }, { time: 2, value: 12 }])
    expect(state.objects[0].transform.position.x).toBe(3)
  })

  it('修改天空颜色不会清掉由画布连线同步的全景环境', () => {
    const state = useCameraStageStore.getState()
    state.setSceneEnvironmentImageUrl('/media/panorama.png')
    state.setSceneSkyColor('next-sky-color')

    expect(useCameraStageStore.getState().sceneSettings.sky).toEqual({
      color: 'next-sky-color',
      environmentImageUrl: '/media/panorama.png',
    })
  })

  it('播放中 seek 同步逐帧 runtime，pause 从精确时刻吸附而不是使用低频 UI 播放头', () => {
    const store = useCameraStageStore.getState()
    store.seek(1)
    store.addStateKeyframe()
    store.seek(0.4)
    store.play()
    expect(readCameraStagePlaybackRuntime()).toMatchObject({ time: 0.4, playing: true })

    store.seek(0.8)
    const sought = useCameraStageStore.getState().playback.currentTime
    expect(readCameraStagePlaybackRuntime().time).toBe(sought)

    const driver = claimCameraStagePlaybackDriver({
      sessionKey: null,
      time: sought,
      playing: true,
    })
    advanceCameraStagePlaybackRuntime({ driver, delta: 0.076, duration: 5, loop: false })
    // UI 仍停在 seek 的低频投影，暂停必须采用 runtime 的 0.876 秒并按 30fps 吸附到 0.8667。
    expect(useCameraStageStore.getState().playback.currentTime).toBe(sought)
    useCameraStageStore.getState().pause()
    expect(useCameraStageStore.getState().playback).toMatchObject({
      playing: false,
      currentTime: expect.closeTo(26 / 30),
    })
    expect(readCameraStagePlaybackRuntime()).toMatchObject({
      playing: false,
      time: expect.closeTo(26 / 30),
    })
  })
})
