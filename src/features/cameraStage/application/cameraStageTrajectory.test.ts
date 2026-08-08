import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  loadProjectIntoScene: vi.fn().mockResolvedValue(true),
}))

vi.mock('../projects/cameraStageProjectService', () => ({
  saveCurrentProject: mocks.saveCurrentProject,
  loadProjectIntoScene: mocks.loadProjectIntoScene,
}))

import type { ApplicationPlannedStep } from '@/core/application-control'

import { compileShotsToAnimation } from '../domain/shotCompiler'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { createShot } from '../domain/shotTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/**
 * 2.5：轨迹手工编辑（`camera_stage.trajectory` 的 5 条可写属性）。
 *
 * 界面上拖任意一个控制点或切线手柄都是"整条路径重新写回"（`StageMotionPathOverlay.tsx`），
 * 没有单独的"改一个控制点"store 方法，所以没有新增 `trajectory_knot` 子实体——`knots` 作为
 * json 数组整体读写，落地到同一个 `store.setShotSpatialPath`；起止端点是另一个 store 动作
 * （`setShotPathAnchor`，语义是改相邻镜头卡里的对象位置快照，不是改 knots）。
 */

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.trajectory, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function trajectoryStep(shotId: string, objectId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation',
    entityType: CAMERA_STAGE_ENTITY_TYPES.trajectory,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.trajectory, id: `project-1:${shotId}:${objectId}`, revision },
    expectedRevisions: { toolbox: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

describe('三维轨迹手工编辑', () => {
  let cameraId: string
  let shotAId: string
  let shotBId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0), {
      position: { x: 0, y: 2, z: 5 },
      target: { x: 0, y: 0, z: 0 },
    })
    cameraId = camera.id
    const shotA = createShot([camera], 'A', camera.id, 0)
    const shotB = createShot([camera], 'B', camera.id, 2)
    shotAId = shotA.id
    shotBId = shotB.id
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera],
      activeCameraId: camera.id,
      animation: compileShotsToAnimation([shotA, shotB], [camera]),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [shotA, shotB],
    }, { id: 'project-1', name: '轨迹编辑测试' })
    // 用运镜预设生成一条真实的可编辑路径（1 个控制点），与界面"先套预设再手动微调"的路径一致。
    useCameraStageStore.getState().applyCameraPathPreset(shotAId, cameraId, { kind: 'orbit', degrees: 180, direction: 'cw' })
  })

  function currentPath() {
    return useCameraStageStore.getState().shots.find((shot) => shot.id === shotAId)!.transition.perObject[cameraId]!.spatialPath!
  }

  it('整条重写 knots 会替换全部控制点', async () => {
    const before = currentPath()
    expect(before.knots).toHaveLength(1)

    await executor.apply(trajectoryStep(shotAId, cameraId, [
      {
        propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.knots`,
        value: [
          { position: { x: 1, y: 1, z: 1 }, inTangent: { x: 0, y: 0, z: 0 }, outTangent: { x: 0, y: 0, z: 0 } },
          { position: { x: 2, y: 2, z: 2 }, inTangent: { x: 0, y: 0, z: 0 }, outTangent: { x: 0, y: 0, z: 0 } },
        ],
      },
    ]))

    const after = currentPath()
    expect(after.knots).toHaveLength(2)
    expect(after.knots[0].position).toEqual({ x: 1, y: 1, z: 1 })
    expect(after.knots[0].id).toBeTruthy()
  })

  it('写入 knots 后轨迹来源被标记为 custom', async () => {
    expect(currentPath().source.kind).toBe('preset')

    await executor.apply(trajectoryStep(shotAId, cameraId, [
      {
        propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.knots`,
        value: [{ position: { x: 1, y: 1, z: 1 }, inTangent: { x: 0, y: 0, z: 0 }, outTangent: { x: 0, y: 0, z: 0 } }],
      },
    ]))

    expect(currentPath().source.kind).toBe('custom')
  })

  it('能改起点/终点切线手柄，不影响 knots', async () => {
    await executor.apply(trajectoryStep(shotAId, cameraId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.start_out_tangent`, value: { x: 1, y: 0, z: 0 } },
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.end_in_tangent`, value: { x: 0, y: 1, z: 0 } },
    ]))

    const path = currentPath()
    expect(path.startOutTangent).toEqual({ x: 1, y: 0, z: 0 })
    expect(path.endInTangent).toEqual({ x: 0, y: 1, z: 0 })
    expect(path.knots).toHaveLength(1)
  })

  it('能挪起点位置，落在这张卡自己的对象快照上', async () => {
    await executor.apply(trajectoryStep(shotAId, cameraId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.start_position`, value: { x: 9, y: 9, z: 9 } },
    ]))

    const shotA = useCameraStageStore.getState().shots.find((shot) => shot.id === shotAId)!
    expect(shotA.objectStates[cameraId].transform.position).toEqual({ x: 9, y: 9, z: 9 })
  })

  it('能挪终点位置，落在下一张卡的对象快照上', async () => {
    await executor.apply(trajectoryStep(shotAId, cameraId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.end_position`, value: { x: 8, y: 8, z: 8 } },
    ]))

    const shotB = useCameraStageStore.getState().shots.find((shot) => shot.id === shotBId)!
    expect(shotB.objectStates[cameraId].transform.position).toEqual({ x: 8, y: 8, z: 8 })
  })

  it('目标镜头卡没有轨迹时拒绝写入', async () => {
    await expect(executor.apply(trajectoryStep(shotBId, cameraId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.trajectory}.start_out_tangent`, value: { x: 1, y: 0, z: 0 } },
    ]))).rejects.toThrow('NOT_FOUND')
  })
})
