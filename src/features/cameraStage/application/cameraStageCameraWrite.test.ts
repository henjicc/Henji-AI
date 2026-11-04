import { loadCameraStageTestProject } from '@/tests/cameraStageProjectFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationPlannedStep } from '@/core/application-control'

import { createDefaultAnimation } from '../domain/animationTypes'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { applyCameraStageMotion } from './cameraMotionService'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/*
 * 回归（外部智能体实测）：经 MCP 写 camera_stage.camera.look_at_target 后读回的旋转角不变、摄像机窗格朝向也不变。
 * 根因：建模写入把对象当前快照整份覆盖进全部状态关键帧且不重新采样当前帧——朝向由注视点在采样时求出，
 * 不采样就停在旧角度；整份覆盖还会把摄像机在其他时间点的机位一并抹平，写一次注视点整段运镜就没了。
 */

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.camera, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function cameraStep(cameraId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation', entityType: CAMERA_STAGE_ENTITY_TYPES.camera,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `project-1:${cameraId}`, revision },
    expectedRevisions: { camera_stage: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

function camera(id: string): StageCameraObject {
  return useCameraStageStore.getState().objects.find((object) => object.id === id) as StageCameraObject
}

function cameraPositions(id: string): StageVec3[] {
  return useCameraStageStore.getState().stateKeyframes.map((stateKeyframe) => stateKeyframe.objectStates[id].transform.position)
}

describe('摄像机属性写入', () => {
  let cameraId: string
  let subjectId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    revision = 1
    const cameraObject = createCameraObject('摄像机01', pickDefaultColor(0))
    cameraObject.transform.position = { x: 0, y: 2, z: 10 }
    cameraObject.lookAt = { mode: 'manual', target: { x: 0, y: 1, z: 0 } }
    const subject = createPrimitiveObject('sphere', '主体', pickDefaultColor(1))
    cameraId = cameraObject.id
    subjectId = subject.id
    const objects = [cameraObject, subject]
    await loadCameraStageTestProject({
      objects, activeCameraId: cameraId, animation: createDefaultAnimation(), sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [createStateKeyframe(objects, '关键帧 1', 0)],
    }, { id: 'project-1', name: '摄像机写入测试' })
    await applyCameraStageMotion({
      projectId: 'project-1', cameraId, targetPoint: { x: 0, y: 1, z: 0 },
      move: { kind: 'dollyIn', distanceRatio: 0.5 }, duration: 4, speed: 'easeInOut',
    })
    useCameraStageStore.getState().seek(0)
  })

  it('写注视点后朝向立即对准新目标，运镜机位保留', async () => {
    const positionsBefore = cameraPositions(cameraId)
    expect(positionsBefore[0]).not.toEqual(positionsBefore[1])
    const target = { x: 4, y: 1, z: 0 }
    await executor.apply(cameraStep(cameraId, [{ propertyId: 'camera_stage.camera.look_at_target', value: target }]))

    const written = camera(cameraId)
    const expected = rotationFromPositionAndTarget(written.transform.position, target, written.transform.rotation.z)
    expect(written.transform.rotation.x).toBeCloseTo(expected.x, 6)
    expect(written.transform.rotation.y).toBeCloseTo(expected.y, 6)
    expect(cameraPositions(cameraId)).toEqual(positionsBefore)
  })

  it('直接写旋转角会换算成同方向的注视点，重新采样后角度保持', async () => {
    await executor.apply(cameraStep(cameraId, [{ propertyId: 'camera_stage.camera.transform.rotation', value: { x: -10, y: 30, z: 0 } }]))
    useCameraStageStore.getState().seek(0)
    const written = camera(cameraId)
    expect(written.lookAt.mode).toBe('manual')
    expect(written.transform.rotation.x).toBeCloseTo(-10, 6)
    expect(written.transform.rotation.y).toBeCloseTo(30, 6)
  })

  it('运镜设备与注视跟随滞后是摄像机级设置，不动任何状态关键帧，只换轨迹的时间律', async () => {
    const before = structuredClone(useCameraStageStore.getState().stateKeyframes)
    await executor.apply(cameraStep(cameraId, [
      { propertyId: 'camera_stage.camera.rig', value: 'crane' },
      { propertyId: 'camera_stage.camera.aim_lag', value: 0.3 },
    ]))
    const state = useCameraStageStore.getState()
    expect(camera(cameraId)).toMatchObject({ rig: 'crane', aimLag: 0.3 })
    expect(state.stateKeyframes).toEqual(before)
    expect(state.animation.spatialMotions.find((motion) => motion.objectId === cameraId)?.rig).toBe('crane')
    expect(subjectId).toBeTruthy()
  })
})
