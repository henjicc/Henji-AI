import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { clearCameraStageHistory, useCameraStageStore } from './cameraStageStore'

describe('3D 镜头工程快照加载', () => {
  beforeEach(() => {
    useCameraStageStore.getState().newScene('测试工程')
    clearCameraStageHistory()
  })

  it('打开工程时立即显示播放头 0 秒的首关键帧画面', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    camera.transform.position.x = 99
    const animation = createDefaultAnimation()
    animation.tracks = [{
      objectId: camera.id,
      propertyPath: 'transform.position.x',
      keyframes: [
        { time: 0, value: 3, easing: 'linear' },
        { time: 2, value: 12, easing: 'linear' },
      ],
    }]

    useCameraStageStore.getState().loadSnapshot({
      objects: [camera],
      activeCameraId: camera.id,
      animation,
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'pro',
      shots: [],
    }, { id: 'camera-project', name: '测试工程' })

    const state = useCameraStageStore.getState()
    expect(state.playback.currentTime).toBe(0)
    expect(state.objects[0].transform.position.x).toBe(3)
  })
})
