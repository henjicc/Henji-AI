import { beforeEach, describe, expect, it, vi } from 'vitest'

const projectMocks = vi.hoisted(() => ({
  saveCurrentProject: vi.fn().mockResolvedValue(undefined),
  loadProjectIntoScene: vi.fn().mockResolvedValue(true),
}))

const reflectionRuntime = vi.hoisted(() => ({
  registry: undefined as unknown,
  engine: undefined as unknown,
}))

vi.mock('../projects/cameraStageProjectService', () => ({
  saveCurrentProject: projectMocks.saveCurrentProject,
  loadProjectIntoScene: projectMocks.loadProjectIntoScene,
}))

vi.mock('@/features/assistant/applicationCapabilities/applicationControlRegistry', () => ({
  getApplicationReflectionRegistry: () => reflectionRuntime.registry,
  getApplicationControlExecutionEngine: () => reflectionRuntime.engine,
}))

import { ApplicationControlExecutionEngine, ApplicationReflectionRegistry } from '@/core/application-control'
import { applicationReflectionHandlers } from '@/features/assistant/applicationCapabilities/applicationReflectionAdapter'

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { deserializeScene, serializeScene } from '../domain/sceneSerialization'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { useCameraStageStore } from '../store/cameraStageStore'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES, createCameraStageReflectionRegistrations } from './cameraStageReflection'
import { verifyCameraStageScene } from './cameraStageVerification'

describe('状态关键帧模式动画的正式反射结果', () => {
  let revision: number
  let objectId: string

  beforeEach(() => {
    vi.clearAllMocks()
    revision = 1
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const object = createPrimitiveObject('sphere', '浮动球', pickDefaultColor(1))
    objectId = object.id
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, object],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [],
    }, { id: 'project-1', name: '简易动画反射测试' })

    const registry = new ApplicationReflectionRegistry('application-capabilities/v2')
    for (const registration of createCameraStageReflectionRegistrations(() => revision)) {
      registry.register(registration)
    }
    const engine = new ApplicationControlExecutionEngine(registry)
    const dependencies = {
      readRevision: () => revision,
      bumpRevision: () => { revision += 1 },
    }
    engine.registerMutationExecutor(new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.playback, dependencies))
    engine.registerMutationExecutor(new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.object, dependencies))
    engine.registerMutationExecutor(new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.camera, dependencies))
    reflectionRuntime.registry = registry
    reflectionRuntime.engine = engine
  })

  function context(requestId: string) {
    return {
      signal: new AbortController().signal,
      requestId,
      expectedRevisions: { toolbox: revision },
    }
  }

  async function setProperty(
    requestId: string,
    entityType: string,
    targetId: string,
    propertyId: string,
    value: number,
  ): Promise<void> {
    await applicationReflectionHandlers.changeEntities({
      summary: `${propertyId}=${value}`,
      changes: [{
        kind: 'set_properties',
        target: { kind: entityType, id: targetId },
        entityType,
        properties: { [propertyId]: value },
      }],
    }, context(requestId))
  }

  it('describe 给出状态关键帧路径，三轮 change 后三个时间点保存不同 y 值', async () => {
    const objectRef = { kind: CAMERA_STAGE_ENTITY_TYPES.object, id: `project-1:${objectId}` }
    const description = await applicationReflectionHandlers.describeEntities({
      domains: ['camera_stage'],
      entityTypes: [],
      refs: [
        { kind: CAMERA_STAGE_ENTITY_TYPES.scene, id: 'project-1' },
        { kind: CAMERA_STAGE_ENTITY_TYPES.playback, id: 'project-1' },
        objectRef,
      ],
    }, context('describe-simple-animation'))
    expect(description.collectionAvailability.find(
      (item) => item.entityType === CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
    )).toMatchObject({ create: { available: true } })

    const timeProperty = `${CAMERA_STAGE_ENTITY_TYPES.playback}.current_time`
    const yProperty = `${CAMERA_STAGE_ENTITY_TYPES.object}.animatable.transform.position.y`
    for (const [index, [time, y]] of [[0, 0], [1, 1.5], [2, 0]].entries()) {
      await setProperty(`seek-${index}`, CAMERA_STAGE_ENTITY_TYPES.playback, 'project-1', timeProperty, time)
      await setProperty(`move-${index}`, CAMERA_STAGE_ENTITY_TYPES.object, objectRef.id, yProperty, y)
    }

    const readBack = await applicationReflectionHandlers.readEntity({
      ref: objectRef,
      propertyIds: [yProperty],
    }, context('read-simple-animation'))
    expect(readBack.properties[yProperty]).toBe(0)
    const yValues = useCameraStageStore.getState().stateKeyframes.map(
      (stateKeyframe) => stateKeyframe.objectStates[objectId]?.transform.position.y,
    )
    expect(yValues).toEqual([0, 1.5, 0])
    const state = useCameraStageStore.getState()
    expect(state.animation.duration).toBeGreaterThanOrEqual(2)
    expect([0, 1, 2].map((time) => applyAnimationAtTime(state.objects, state.animation, time)
      .find((object) => object.id === objectId)?.transform.position.y)).toEqual([0, 1.5, 0])

    const reloaded = deserializeScene(serializeScene({
      objects: state.objects,
      activeCameraId: state.activeCameraId,
      sceneSettings: state.sceneSettings,
      stateKeyframes: state.stateKeyframes,
    }))
    expect(reloaded.stateKeyframes.map((item) => item.objectStates[objectId]?.transform.position.y))
      .toEqual([0, 1.5, 0])
    expect([0, 1, 2].map((time) => applyAnimationAtTime(reloaded.objects, reloaded.animation, time)
      .find((object) => object.id === objectId)?.transform.position.y)).toEqual([0, 1.5, 0])
  })

  it('摄像机位置、旋转与 fov 写入会自动记录完整状态关键帧，同一时间只更新不重复', async () => {
    const camera = useCameraStageStore.getState().objects.find((item) => item.type === 'camera')
    if (!camera) throw new Error('测试需要摄像机')
    const cameraRef = `project-1:${camera.id}`
    const timeProperty = `${CAMERA_STAGE_ENTITY_TYPES.playback}.current_time`
    const positionProperty = `${CAMERA_STAGE_ENTITY_TYPES.camera}.animatable.transform.position.x`
    const rotationProperty = `${CAMERA_STAGE_ENTITY_TYPES.camera}.animatable.transform.rotation.y`
    const fovProperty = `${CAMERA_STAGE_ENTITY_TYPES.camera}.animatable.fov`

    await setProperty('camera-time-0', CAMERA_STAGE_ENTITY_TYPES.playback, 'project-1', timeProperty, 0)
    await setProperty('camera-position-0', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, positionProperty, 1)
    await setProperty('camera-rotation-0', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, rotationProperty, 5)
    await setProperty('camera-fov-0', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, fovProperty, 40)
    await setProperty('camera-time-1', CAMERA_STAGE_ENTITY_TYPES.playback, 'project-1', timeProperty, 1)
    await setProperty('camera-position-1', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, positionProperty, 4)
    await setProperty('camera-rotation-1', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, rotationProperty, 30)
    await setProperty('camera-fov-1', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, fovProperty, 60)

    const beforeUpdateCount = useCameraStageStore.getState().stateKeyframes.length
    await setProperty('camera-fov-1-update', CAMERA_STAGE_ENTITY_TYPES.camera, cameraRef, fovProperty, 65)
    const state = useCameraStageStore.getState()
    expect(state.stateKeyframes).toHaveLength(beforeUpdateCount)
    expect(state.stateKeyframes.map((item) => item.objectStates[camera.id]?.transform.position.x)).toEqual([1, 4])
    expect(state.stateKeyframes.map((item) => item.objectStates[camera.id]?.transform.rotation.y)).toEqual([5, 30])
    expect(state.stateKeyframes.map((item) => item.objectStates[camera.id]?.fov)).toEqual([40, 65])
    const sampledCamera = applyAnimationAtTime(state.objects, state.animation, 1)
      .find((item) => item.id === camera.id)
    expect(sampledCamera?.type).toBe('camera')
    expect(sampledCamera?.type === 'camera' ? sampledCamera.fov : undefined).toBe(65)
  })

  it('一次 change 内连续定位播放头并写属性，也会落成多个状态关键帧', async () => {
    const objectRef = { kind: CAMERA_STAGE_ENTITY_TYPES.object, id: `project-1:${objectId}` }
    const timeProperty = `${CAMERA_STAGE_ENTITY_TYPES.playback}.current_time`
    const yProperty = `${CAMERA_STAGE_ENTITY_TYPES.object}.animatable.transform.position.y`

    const result = await applicationReflectionHandlers.changeEntities({
      summary: '一次事务写入球体上下浮动并开始播放',
      changes: [
        ...[[0, 0.5], [1, 1.5], [2, 0.25]].flatMap(([time, y]) => ([
        {
          kind: 'set_properties' as const,
          target: { kind: CAMERA_STAGE_ENTITY_TYPES.playback, id: 'project-1' },
          entityType: CAMERA_STAGE_ENTITY_TYPES.playback,
          properties: { [timeProperty]: time },
        },
        {
          kind: 'set_properties' as const,
          target: objectRef,
          entityType: CAMERA_STAGE_ENTITY_TYPES.object,
          properties: { [yProperty]: y },
        },
        ])),
        {
          kind: 'set_properties',
          target: { kind: CAMERA_STAGE_ENTITY_TYPES.playback, id: 'project-1' },
          entityType: CAMERA_STAGE_ENTITY_TYPES.playback,
          properties: {
            [timeProperty]: 0,
            [`${CAMERA_STAGE_ENTITY_TYPES.playback}.loop`]: true,
            [`${CAMERA_STAGE_ENTITY_TYPES.playback}.playing`]: true,
          },
        },
      ],
    }, context('single-call-animation'))

    expect(useCameraStageStore.getState().stateKeyframes.map(
      (stateKeyframe) => [stateKeyframe.time, stateKeyframe.objectStates[objectId]?.transform.position.y],
    )).toEqual([[0, 0.5], [1, 1.5], [2, 0.25]])
    expect(useCameraStageStore.getState().playback.playing).toBe(true)
    expect(useCameraStageStore.getState().playback.loop).toBe(true)
    expect(projectMocks.loadProjectIntoScene).not.toHaveBeenCalled()
    const cascadingEffects = result.effects.flatMap((item) => {
      const origin = item.origin as { kind?: string }
      return origin.kind === 'cascade' && item.entityType === CAMERA_STAGE_ENTITY_TYPES.stateKeyframe
        ? [item.effect] : []
    })
    expect(cascadingEffects).toHaveLength(3)
    expect(cascadingEffects.filter((effect) => effect === 'create').length).toBeGreaterThanOrEqual(2)

    const verified = await verifyCameraStageScene({
      projectId: 'project-1',
      expectedObjectIds: [],
      expectedObjectRefs: [objectRef],
      expectedStateSamples: [[0, 0.5], [1, 1.5], [2, 0.25]].map(([time, value]) => ({
        objectRef,
        time,
        propertyId: yProperty,
        value,
      })),
      expectedPlayback: { playing: true, loop: true },
      requireNoCollisions: true,
    })
    expect(verified).toMatchObject({ verified: true, unmetConditions: [] })
    expect(verified.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'state_keyframe', data: expect.objectContaining({ samples: expect.any(Array) }) }),
      expect.objectContaining({ kind: 'playback', data: expect.objectContaining({ playing: true, loop: true }) }),
    ]))
  })

})
