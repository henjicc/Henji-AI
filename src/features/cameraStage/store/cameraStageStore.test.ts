import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { clearCameraStageHistory, useCameraStageStore } from './cameraStageStore'

describe('3D 镜头工程快照加载', () => {
  beforeEach(() => {
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
})
