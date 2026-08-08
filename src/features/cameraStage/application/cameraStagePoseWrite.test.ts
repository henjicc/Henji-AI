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

import { poseJointPath } from '../domain/animatableProps'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createCharacterObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { upsertTrackKeyframe } from '../store/animationActions'
import { useCameraStageStore } from '../store/cameraStageStore'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/**
 * 2.4·方案 C：`camera_stage.object.animatable.*`（63 条）与 `pose_preset` 直接写入。
 *
 * 核心陷阱（重要记录 002）：助手写静态值，该轨道恰好已有关键帧 → 播放头一动，采样器
 * 把值覆盖回插值结果，用户看到"改好了又跳回去"。这几条用例守两件事：无轨道时是纯静态写入
 * （拖动播放头不受影响）；有轨道时写入等价于在当前时间点打/改一个关键帧（拖动播放头回同一
 * 时间点，值必须是刚写的那个，不是旧的插值结果）——两者都不是新逻辑，是 store 里
 * `updateTransform`/`updatePoseJoint`/`updateObject` 的 `autoKeyPaths` 分支本就有的行为，
 * 这里验证的是新接入的属性写入路径真的调用到了它们。
 */

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.object, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function objectStep(objectId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation',
    entityType: CAMERA_STAGE_ENTITY_TYPES.object,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.object, id: `project-1:${objectId}`, revision },
    expectedRevisions: { toolbox: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

/** 与 cameraStageObjectFields.ts 的 animatablePropertyPathId() 保持完全一致的 id 生成规则。 */
function animatablePropertyId(path: string): string {
  return `${CAMERA_STAGE_ENTITY_TYPES.object}.animatable.${path.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`)}`
}

const SHOULDER_L_X_PATH = `${poseJointPath('shoulderL')}.x`
const SHOULDER_L_X_PROPERTY = animatablePropertyId(SHOULDER_L_X_PATH)
const ELBOW_L_X_PATH = `${poseJointPath('elbowL')}.x`
const ELBOW_L_X_PROPERTY = animatablePropertyId(ELBOW_L_X_PATH)

describe('三维姿态关节直接写入（方案 C）', () => {
  let characterId: string

  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const character = createCharacterObject('角色01', pickDefaultColor(1))
    characterId = character.id
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, character],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '姿态写入测试' })
  })

  function currentJointX(): number | undefined {
    const object = useCameraStageStore.getState().objects.find((candidate) => candidate.id === characterId)
    return object?.type === 'character' ? object.pose.joints.shoulderL?.x : undefined
  }

  it('轨道无关键帧时写值是纯静态写入，不产生关键帧', async () => {
    await executor.apply(objectStep(characterId, [{ propertyId: SHOULDER_L_X_PROPERTY, value: 30 }]))

    expect(currentJointX()).toBe(30)
    expect(useCameraStageStore.getState().animation.tracks.find(
      (track) => track.objectId === characterId && track.propertyPath === SHOULDER_L_X_PATH,
    )).toBeUndefined()
  })

  it('轨道无关键帧时，拖动播放头不影响刚写入的静态值', async () => {
    await executor.apply(objectStep(characterId, [{ propertyId: SHOULDER_L_X_PROPERTY, value: 30 }]))
    useCameraStageStore.getState().seek(2)
    useCameraStageStore.getState().seek(0)

    expect(currentJointX()).toBe(30)
  })

  it('轨道已有关键帧时写值，等价于在当前播放时间点新建一个关键帧', async () => {
    useCameraStageStore.setState((state) => ({
      animation: upsertTrackKeyframe(upsertTrackKeyframe(state.animation, characterId, SHOULDER_L_X_PATH, 0, 0), characterId, SHOULDER_L_X_PATH, 2, 90),
    }))
    useCameraStageStore.getState().seek(1)

    await executor.apply(objectStep(characterId, [{ propertyId: SHOULDER_L_X_PROPERTY, value: 30 }]))

    expect(currentJointX()).toBe(30)
    const track = useCameraStageStore.getState().animation.tracks.find(
      (candidate) => candidate.objectId === characterId && candidate.propertyPath === SHOULDER_L_X_PATH,
    )
    expect(track?.keyframes.some((keyframe) => Math.abs(keyframe.time - 1) < 1e-6 && keyframe.value === 30)).toBe(true)
  })

  it('关键回归：写完之后拖动播放头，值不会跳回插值结果', async () => {
    useCameraStageStore.setState((state) => ({
      animation: upsertTrackKeyframe(upsertTrackKeyframe(state.animation, characterId, SHOULDER_L_X_PATH, 0, 0), characterId, SHOULDER_L_X_PATH, 2, 90),
    }))
    useCameraStageStore.getState().seek(1)
    await executor.apply(objectStep(characterId, [{ propertyId: SHOULDER_L_X_PROPERTY, value: 30 }]))

    // 拖动播放头离开再回到同一时间点，模拟用户在助手写完之后 scrub 时间轴。
    useCameraStageStore.getState().seek(2)
    useCameraStageStore.getState().seek(1)

    expect(currentJointX()).toBe(30)
  })

  it('简易模式下拒绝写入，提示改用集合写入或先转专业模式', async () => {
    useCameraStageStore.setState({ editorMode: 'simple' })

    await expect(executor.apply(objectStep(characterId, [{ propertyId: SHOULDER_L_X_PROPERTY, value: 30 }])))
      .rejects.toThrow('ANIMATABLE_WRITE_REQUIRES_PRO_MODE')
  })

  it('一批写入里混用动画属性和建模属性时整批拒绝', async () => {
    await expect(executor.apply(objectStep(characterId, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.object}.name`, value: '改名' },
      { propertyId: SHOULDER_L_X_PROPERTY, value: 30 },
    ]))).rejects.toThrow('MIXED_MUTATION_NOT_SUPPORTED')
  })

  it('能一次写多个关节分量，互不干扰', async () => {
    await executor.apply(objectStep(characterId, [
      { propertyId: SHOULDER_L_X_PROPERTY, value: 15 },
      { propertyId: ELBOW_L_X_PROPERTY, value: 45 },
    ]))

    const object = useCameraStageStore.getState().objects.find((candidate) => candidate.id === characterId)
    expect(object?.type === 'character' ? object.pose.joints.shoulderL?.x : undefined).toBe(15)
    expect(object?.type === 'character' ? object.pose.joints.elbowL?.x : undefined).toBe(45)
  })
})

describe('三维姿态预设套用（pose_preset）', () => {
  let characterId: string
  let primitiveId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const character = createCharacterObject('角色01', pickDefaultColor(1))
    const { createPrimitiveObject } = await import('../domain/sceneDefaults')
    const primitive = createPrimitiveObject('box', '立方体', pickDefaultColor(2))
    characterId = character.id
    primitiveId = primitive.id
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, character, primitive],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '姿态预设测试' })
  })

  const POSE_PRESET_PROPERTY = `${CAMERA_STAGE_ENTITY_TYPES.object}.pose_preset`

  it('套用已知预设后角色姿态整体替换', async () => {
    await executor.apply(objectStep(characterId, [{ propertyId: POSE_PRESET_PROPERTY, value: 'stand' }]))

    const object = useCameraStageStore.getState().objects.find((candidate) => candidate.id === characterId)
    expect(object?.type === 'character' ? object.pose.joints.torso : undefined).toBeDefined()
  })

  it('未知预设 id 被拒绝', async () => {
    await expect(executor.apply(objectStep(characterId, [{ propertyId: POSE_PRESET_PROPERTY, value: '不存在的预设' }])))
      .rejects.toThrow('POSE_PRESET_NOT_FOUND')
  })

  it('对非角色对象套用预设被拒绝', async () => {
    await expect(executor.apply(objectStep(primitiveId, [{ propertyId: POSE_PRESET_PROPERTY, value: 'stand' }])))
      .rejects.toThrow('OBJECT_TYPE_MISMATCH')
  })
})
