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
 * 回归：**改状态关键帧的时间点**。
 *
 * `camera_stage.state_keyframe.time` 在反射层一直声明为可写，但执行器那条手写 if-else 链里没有对应分支，
 * 助手改镜头时间点必然拿到 PROPERTY_NOT_WRITABLE。实体级覆盖门禁看不见这种缺口（stateKeyframe 有
 * mutation 执行器就算过），所以它一直全绿。
 *
 * propertyCoverage 门禁负责让这类缺口在声明层面无处藏身；这几条用例负责证明写入真的落到了
 * 时间轴上——两者缺一不可：门禁只比对集合，不验证行为。
 */

let revision = 1
const executor = new CameraStageMutationExecutor(CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, {
  readRevision: () => revision,
  bumpRevision: () => { revision += 1 },
})

function stateKeyframeStep(stateKeyframeId: string, mutations: Array<{ propertyId: string; value: unknown }>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return {
    kind: 'mutation',
    entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
    target: { kind: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, id: `project-1:${stateKeyframeId}`, revision },
    expectedRevisions: { toolbox: revision },
    mutations: mutations.map((mutation) => ({ ...mutation, operation: 'set' })),
  } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
}

function stateKeyframeTimes(): number[] {
  return useCameraStageStore.getState().stateKeyframes.map((stateKeyframe) => stateKeyframe.time)
}

describe('三维状态关键帧属性写入', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [],
    }, { id: 'project-1', name: '状态关键帧测试' })
    const store = useCameraStageStore.getState()
    store.addStateKeyframe()
    useCameraStageStore.getState().seek(2)
    useCameraStageStore.getState().addStateKeyframe()
  })

  it('能把一张状态关键帧挪到新的时间点', async () => {
    const stateKeyframes = useCameraStageStore.getState().stateKeyframes
    expect(stateKeyframes.length).toBe(2)
    const second = stateKeyframes[1]
    expect(second.time).toBeCloseTo(2, 3)

    await executor.apply(stateKeyframeStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.stateKeyframe}.time`, value: 1.5 },
    ]))

    const moved = useCameraStageStore.getState().stateKeyframes.find((stateKeyframe) => stateKeyframe.id === second.id)
    expect(moved?.time).toBeCloseTo(1.5, 2)
  })

  it('时间点与名称可以同一批写入，状态关键帧仍按时间有序', async () => {
    const second = useCameraStageStore.getState().stateKeyframes[1]
    await executor.apply(stateKeyframeStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.stateKeyframe}.name`, value: '收尾镜头' },
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.stateKeyframe}.time`, value: 1.2 },
    ]))

    const updated = useCameraStageStore.getState().stateKeyframes.find((stateKeyframe) => stateKeyframe.id === second.id)
    expect(updated?.name).toBe('收尾镜头')
    expect(updated?.time).toBeCloseTo(1.2, 2)
    // 时间轴的不变量：状态关键帧永远按时间升序，改一张不能把顺序改乱。
    expect(stateKeyframeTimes()).toEqual([...stateKeyframeTimes()].sort((a, b) => a - b))
  })

  it('未声明的属性被拒绝，错误里带出属性 id 和可写清单', async () => {
    const second = useCameraStageStore.getState().stateKeyframes[1]
    await expect(executor.apply(stateKeyframeStep(second.id, [
      { propertyId: `${CAMERA_STAGE_ENTITY_TYPES.stateKeyframe}.not_a_property`, value: 1 },
    ]))).rejects.toThrow('PROPERTY_NOT_WRITABLE:camera_stage.state_keyframe.not_a_property')
  })
})
