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
 * 实测事故：模型给 `place_camera_stage_object` 传了一个不存在的 targetObjectId，工具报
 * EXECUTION_FAILED，但**圆柱体已经被创建出来并停在默认位置**，正好压在立方体上。
 *
 * 原因是校验顺序反了：对象先 `addPrimitive()` 建好，之后才调 `resolveScenePlacement`，
 * 而后者对不存在的 targetObjectId 抛裸 NOT_FOUND。`captureCameraStageUndo` 抓的快照一直
 * 存在，却从没接到失败路径上。
 *
 * 于是"事务失败"与"场景已被改动"同时成立——模型据此判断该重试还是该补救，必然判错。
 */
describe('三维布置失败不留残留', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [],
    }, { id: 'project-1', name: '布置失败测试' })
  })

  it('targetObjectId 不存在时在写入之前就被拒绝，场景对象数量不变', async () => {
    const before = useCameraStageStore.getState().objects.length

    await expect(cameraStageApplicationService.placeObject({
      projectId: 'project-1',
      spec: { objectType: 'primitive', primitiveKind: 'cylinder', reusePolicy: 'require_new' },
      placement: { mode: 'beside', targetObjectId: '不存在的对象', spacing: 0.35, allowOverlap: false },
    })).rejects.toThrow('TARGET_OBJECT_NOT_FOUND')

    expect(useCameraStageStore.getState().objects).toHaveLength(before)
    // 没有发生写入，就不该落盘
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('错误信息列出可用 id，模型才有可能自我修正', async () => {
    const cube = useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!

    await expect(cameraStageApplicationService.placeObject({
      projectId: 'project-1',
      spec: { objectType: 'primitive', primitiveKind: 'cylinder', reusePolicy: 'require_new' },
      placement: { mode: 'beside', targetObjectId: '立方体', spacing: 0.35, allowOverlap: false },
    })).rejects.toThrow(cube.id)
  })

  it('targetObjectId 合法时正常布置，且不与参照对象重叠', async () => {
    const cube = useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!

    const result = await cameraStageApplicationService.placeObject({
      projectId: 'project-1',
      spec: { objectType: 'primitive', primitiveKind: 'cylinder', reusePolicy: 'require_new' },
      placement: { mode: 'beside', targetObjectId: cube.id, spacing: 0.35, allowOverlap: false },
    })

    expect(result.decision).toBe('created')
    expect(result.conflicts).toEqual([])
    expect(useCameraStageStore.getState().objects).toHaveLength(3)
  })
})
