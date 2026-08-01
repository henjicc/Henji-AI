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
import { applyCameraStageMotion } from './cameraMotionService'

describe('三维摄像机语义运镜', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))
    const subject = createPrimitiveObject('sphere', '主体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, subject],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '运镜测试' })
  })

  it('在专业模式把环绕语义编译为可撤销的摄像机关键帧事务', async () => {
    const state = useCameraStageStore.getState()
    const camera = state.objects.find((object) => object.type === 'camera')!
    const subject = state.objects.find((object) => object.type === 'primitive')!

    const result = await applyCameraStageMotion({
      projectId: 'project-1',
      cameraId: camera.id,
      targetObjectId: subject.id,
      move: { kind: 'orbit', degrees: 90, direction: 'cw' },
      duration: 2,
      speed: 'easeInOut',
    })

    const updated = useCameraStageStore.getState()
    const updatedCamera = updated.objects.find((object) => object.id === camera.id && object.type === 'camera')
    expect(result.moveKind).toBe('orbit')
    expect(result.affectedKeyframeCount).toBeGreaterThan(0)
    expect(result.path.sampleCount).toBeGreaterThan(1)
    expect(result.undoToken).toMatch(/^camera-stage-undo:/)
    expect(updated.animation.tracks.filter((track) => track.objectId === camera.id)).toHaveLength(3)
    expect(updatedCamera?.type).toBe('camera')
    if (updatedCamera?.type !== 'camera') throw new Error('测试摄像机不存在')
    expect(updatedCamera.lookAt).toMatchObject({ mode: 'object', objectId: subject.id })
    expect(mocks.saveCurrentProject).toHaveBeenCalledOnce()
    expect(mocks.loadProjectIntoScene).not.toHaveBeenCalled()
  })

  it('拒绝没有目标的非升降运镜', async () => {
    const camera = useCameraStageStore.getState().objects.find((object) => object.type === 'camera')!

    await expect(applyCameraStageMotion({
      projectId: 'project-1',
      cameraId: camera.id,
      move: { kind: 'dollyIn', distanceRatio: 0.5 },
      duration: 1,
      speed: 'uniform',
    })).rejects.toThrow('TARGET_REQUIRED')
  })
})
