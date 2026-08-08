import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  loadProjectIntoScene: vi.fn().mockResolvedValue(true),
  bakeCurrentProjectToPro: vi.fn(),
}))

vi.mock('../projects/cameraStageProjectService', () => ({
  saveCurrentProject: mocks.saveCurrentProject,
  loadProjectIntoScene: mocks.loadProjectIntoScene,
  bakeCurrentProjectToPro: mocks.bakeCurrentProjectToPro,
}))

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraStageApplicationService } from './cameraStageApplicationService'

/**
 * 2.3：`cameraStageApplicationService.bakeToProMode(projectId)` 是烘焙能力的正式入口，
 * 委托给已有业务逻辑 `bakeCurrentProjectToPro()`（与界面 EditorModeBadge 同一份实现，
 * 已由 shotSlice.test.ts 覆盖），这里只测新加的这一层：project 定位与 status 归类。
 */
describe('三维工程烘焙入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bakeCurrentProjectToPro.mockImplementation(async () => {
      useCameraStageStore.getState().bakeToProMode()
      return { id: 'project-1', name: '烘焙测试' }
    })
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [],
    }, { id: 'project-1', name: '烘焙测试' })
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().addShot()
  })

  it('简易模式下委托真正的烘焙逻辑，返回 baked 状态与烘焙前后的数量', async () => {
    const shotCountBefore = useCameraStageStore.getState().shots.length

    const result = await cameraStageApplicationService.bakeToProMode('project-1')

    expect(mocks.bakeCurrentProjectToPro).toHaveBeenCalledOnce()
    expect(result.status).toBe('baked')
    expect(result.shotCount).toBe(shotCountBefore)
    expect(useCameraStageStore.getState().editorMode).toBe('pro')
    expect(useCameraStageStore.getState().shots).toEqual([])
    expect(result.trackCount).toBe(useCameraStageStore.getState().animation.tracks.length)
  })

  it('已经是专业模式时是安全的空操作，不调用烘焙逻辑', async () => {
    useCameraStageStore.getState().bakeToProMode()
    mocks.bakeCurrentProjectToPro.mockClear()

    const result = await cameraStageApplicationService.bakeToProMode('project-1')

    expect(mocks.bakeCurrentProjectToPro).not.toHaveBeenCalled()
    expect(result.status).toBe('already_pro')
  })

  it('未打开目标工程时先加载', async () => {
    useCameraStageStore.setState({ currentProjectId: '别的工程' })

    await cameraStageApplicationService.bakeToProMode('project-1')

    expect(mocks.loadProjectIntoScene).toHaveBeenCalledWith('project-1')
  })
})
