import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  loadProjectIntoScene: vi.fn().mockResolvedValue(true),
}))

vi.mock('../projects/cameraStageProjectService', () => mocks)

import type { ApplicationPlannedStep } from '@/core/application-control'

import { poseJointPath } from '../domain/animatableProps'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createCharacterObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.object, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function objectStep(objectId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation', entityType: CAMERA_STAGE_ENTITY_TYPES.object,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.object, id: `project-1:${objectId}`, revision },
    expectedRevisions: { toolbox: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

function animatablePropertyId(path: string): string {
  return `${CAMERA_STAGE_ENTITY_TYPES.object}.animatable.${path.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`)}`
}

describe('三维姿态状态关键帧写入', () => {
  let characterId: string
  let primitiveId: string

  beforeEach(() => {
    vi.clearAllMocks()
    revision = 1
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const character = createCharacterObject('角色01', pickDefaultColor(1))
    const primitive = createPrimitiveObject('box', '立方体', pickDefaultColor(2))
    characterId = character.id
    primitiveId = primitive.id
    const objects = [camera, character, primitive]
    useCameraStageStore.getState().loadSnapshot({
      objects,
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [createStateKeyframe(objects, '关键帧 1', camera.id, 0)],
    }, { id: 'project-1', name: '姿态写入测试' })
  })

  it('关节属性写入更新当前状态关键帧，并可一次写多个分量', async () => {
    const shoulder = animatablePropertyId(`${poseJointPath('shoulderL')}.x`)
    const elbow = animatablePropertyId(`${poseJointPath('elbowL')}.x`)
    await executor.apply(objectStep(characterId, [
      { propertyId: shoulder, value: 15 },
      { propertyId: elbow, value: 45 },
    ]))

    const state = useCameraStageStore.getState()
    const character = state.objects.find((candidate) => candidate.id === characterId)
    expect(character?.type === 'character' ? character.pose.joints.shoulderL?.x : undefined).toBe(15)
    expect(character?.type === 'character' ? character.pose.joints.elbowL?.x : undefined).toBe(45)
    expect(state.stateKeyframes[0]?.objectStates[characterId]?.pose?.joints.shoulderL?.x).toBe(15)
  })

  it('姿态预设写入状态关键帧，非法目标仍被拒绝', async () => {
    const propertyId = `${CAMERA_STAGE_ENTITY_TYPES.object}.pose_preset`
    await executor.apply(objectStep(characterId, [{ propertyId, value: 'stand' }]))
    expect(useCameraStageStore.getState().stateKeyframes[0]?.objectStates[characterId]?.pose).toBeDefined()
    await expect(executor.apply(objectStep(characterId, [{ propertyId, value: '不存在的预设' }])))
      .rejects.toThrow('POSE_PRESET_NOT_FOUND')
    await expect(executor.apply(objectStep(primitiveId, [{ propertyId, value: 'stand' }])))
      .rejects.toThrow('OBJECT_TYPE_MISMATCH')
  })

  it('建模属性与动画属性混写会整批拒绝', async () => {
    const propertyId = animatablePropertyId(`${poseJointPath('shoulderL')}.x`)
    await expect(executor.apply(objectStep(characterId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.object}.name`, value: '改名' },
      { propertyId, value: 30 },
    ]))).rejects.toThrow('MIXED_MUTATION_NOT_SUPPORTED')
  })
})
