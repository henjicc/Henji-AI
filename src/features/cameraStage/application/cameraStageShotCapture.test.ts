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

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import { CameraStageMutationExecutor } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/**
 * 2.2：把当前对象的实时状态记录进指定镜头卡（`camera_stage.shot.capture_object_refs`）。
 *
 * 助手版不依赖"选中态"——直接指定目标 shotId，只覆盖列出的对象、只落在这一张卡上。这几条
 * 用例主要守住一件事：不能重新打开 `modelingWrite.test.ts` 那个已修问题——写入不能溢出到
 * 其他镜头卡，也不能溢出到这张卡上未列出的对象。
 */

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.shot, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function shotStep(shotId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation',
    entityType: CAMERA_STAGE_ENTITY_TYPES.shot,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.shot, id: `project-1:${shotId}`, revision },
    expectedRevisions: { toolbox: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

function moveLiveObject(objectId: string, position: { x: number; y: number; z: number }): void {
  useCameraStageStore.setState((state) => ({
    objects: state.objects.map((object) => (
      object.id === objectId ? { ...object, transform: { ...object.transform, position } } : object
    )),
  }))
}

describe('三维镜头卡状态捕获（capture_object_refs）', () => {
  let cubeId: string
  let sphereId: string
  let cubeDefaultPosition: { x: number; y: number; z: number }
  let sphereDefaultPosition: { x: number; y: number; z: number }

  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    const sphere = createPrimitiveObject('sphere', '球体', pickDefaultColor(2))
    cubeId = cube.id
    sphereId = sphere.id
    cubeDefaultPosition = { ...cube.transform.position }
    sphereDefaultPosition = { ...sphere.transform.position }
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube, sphere],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [],
    }, { id: 'project-1', name: '状态捕获测试' })
    useCameraStageStore.getState().addShot()
    useCameraStageStore.getState().seek(2)
    useCameraStageStore.getState().addShot()
  })

  it('只把列出的对象的实时状态记录进目标卡，不动这张卡上未列出的对象', async () => {
    const second = useCameraStageStore.getState().shots[1]
    moveLiveObject(cubeId, { x: 5, y: 0, z: 0 })

    await executor.apply(shotStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.shot}.capture_object_refs`, value: [cubeId] },
    ]))

    const updated = useCameraStageStore.getState().shots.find((shot) => shot.id === second.id)!
    expect(updated.objectStates[cubeId]?.transform.position).toEqual({ x: 5, y: 0, z: 0 })
    // 球体没被列出，这张卡上球体的快照必须原样不变。
    expect(updated.objectStates[sphereId]?.transform.position).toEqual(sphereDefaultPosition)
  })

  it('不触碰其他镜头卡——不重新打开 modelingWrite 那个已修问题', async () => {
    const [first, second] = useCameraStageStore.getState().shots
    moveLiveObject(cubeId, { x: 5, y: 0, z: 0 })

    await executor.apply(shotStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.shot}.capture_object_refs`, value: [cubeId] },
    ]))

    const untouchedFirst = useCameraStageStore.getState().shots.find((shot) => shot.id === first.id)!
    expect(untouchedFirst.objectStates[cubeId]?.transform.position).toEqual(cubeDefaultPosition)
  })

  it('能一次捕获多个对象', async () => {
    const second = useCameraStageStore.getState().shots[1]
    moveLiveObject(cubeId, { x: 1, y: 0, z: 0 })
    moveLiveObject(sphereId, { x: 0, y: 3, z: 0 })

    await executor.apply(shotStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.shot}.capture_object_refs`, value: [cubeId, sphereId] },
    ]))

    const updated = useCameraStageStore.getState().shots.find((shot) => shot.id === second.id)!
    expect(updated.objectStates[cubeId]?.transform.position).toEqual({ x: 1, y: 0, z: 0 })
    expect(updated.objectStates[sphereId]?.transform.position).toEqual({ x: 0, y: 3, z: 0 })
  })

  it('对象 id 不存在时拒绝写入，不改动任何镜头卡', async () => {
    const second = useCameraStageStore.getState().shots[1]
    const before = structuredClone(useCameraStageStore.getState().shots)

    await expect(executor.apply(shotStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.shot}.capture_object_refs`, value: ['不存在的对象'] },
    ]))).rejects.toThrow('SHOT_CAPTURE_OBJECT_NOT_FOUND')

    expect(useCameraStageStore.getState().shots).toEqual(before)
  })

  it('接受带工程前缀的稳定引用', async () => {
    const second = useCameraStageStore.getState().shots[1]
    moveLiveObject(cubeId, { x: 9, y: 0, z: 0 })

    await executor.apply(shotStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.shot}.capture_object_refs`, value: [`project-1:${cubeId}`] },
    ]))

    const updated = useCameraStageStore.getState().shots.find((shot) => shot.id === second.id)!
    expect(updated.objectStates[cubeId]?.transform.position).toEqual({ x: 9, y: 0, z: 0 })
  })
})
