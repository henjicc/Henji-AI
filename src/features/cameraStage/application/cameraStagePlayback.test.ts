import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  loadProjectIntoScene: vi.fn().mockResolvedValue(true),
}))

vi.mock('../projects/cameraStageProjectService', () => ({
  saveCurrentProject: mocks.saveCurrentProject,
  loadProjectIntoScene: mocks.loadProjectIntoScene,
}))

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraStageApplicationService } from './cameraStageApplicationService'

/**
 * 播放控制此前完全没注册：助手做完一段动画，只能让用户自己去点播放确认效果。
 * 现在它是 `camera_stage.playback` 单例实体的三条属性，走通用动词，零新增工具。
 *
 * 播放是会话态，不进工程文件——所以只有当前打开的工程才读得到，别的工程读出 null，
 * 反射层据此不把它们列出来。
 */

const PROJECT_ID = 'project-1'

describe('三维播放控制', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: { ...createDefaultAnimation(), duration: 10 },
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [],
    }, { id: PROJECT_ID, name: '播放测试' })
    // 时间轴上要有东西才播得动，这是界面上"播放按钮是不是灰的"的同一个条件。
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(5)
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(0)
  })

  it('能跳转播放头、开循环、开始播放', async () => {
    const result = await cameraStageApplicationService.updatePlayback(PROJECT_ID, {
      currentTime: 3,
      loop: true,
      playing: true,
    })
    expect(result.playback.currentTime).toBeCloseTo(3, 2)
    expect(result.playback.loop).toBe(true)
    expect(result.playback.playing).toBe(true)
  })

  it('同一批里先定位再播放，播放不会把刚跳到的位置拽回去', async () => {
    await cameraStageApplicationService.updatePlayback(PROJECT_ID, { currentTime: 4, playing: true })
    const playback = cameraStageApplicationService.readPlayback(PROJECT_ID)
    expect(playback?.playing).toBe(true)
    expect(playback?.currentTime).toBeCloseTo(4, 2)
  })

  it('暂停后播放头停在原处', async () => {
    await cameraStageApplicationService.updatePlayback(PROJECT_ID, { currentTime: 2, playing: true })
    await cameraStageApplicationService.updatePlayback(PROJECT_ID, { playing: false })
    const playback = cameraStageApplicationService.readPlayback(PROJECT_ID)
    expect(playback?.playing).toBe(false)
    expect(playback?.currentTime).toBeCloseTo(2, 2)
  })

  it('播放状态是会话态：没打开的工程读不到，反射层据此不列出它', () => {
    expect(cameraStageApplicationService.readPlayback('another-project')).toBeNull()
    expect(cameraStageApplicationService.readPlayback(PROJECT_ID)).not.toBeNull()
  })

  it('负数时间被拒绝', async () => {
    await expect(cameraStageApplicationService.updatePlayback(PROJECT_ID, { currentTime: -1 }))
      .rejects.toThrow('INVALID_TIME_RANGE')
  })

  it('时间轴空的时候播放会明确报错，而不是静默什么都不做', async () => {
    useCameraStageStore.getState().newScene('空场景')
    useCameraStageStore.getState().bindProject(PROJECT_ID, '空场景')
    await expect(cameraStageApplicationService.updatePlayback(PROJECT_ID, { playing: true }))
      .rejects.toThrow('PLAYBACK_NOT_READY')
  })
})
