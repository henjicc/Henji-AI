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
import { CameraStageKeyframeCollectionExecutor } from './cameraStageKeyframeCollectionExecutor'
import { cameraStageKeyframeService } from './cameraStageKeyframeService'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/**
 * 「两个物体上下漂浮」这类需求以前无解：`camera_stage.keyframe` 的实体、属性、provider 全都
 * 注册齐了，助手能读能改，却**建不出新的关键帧**——通用写入只能改已有实体的属性，创建一律
 * 要手写专用能力，而关键帧那一份没人写。助手只能回一句"没有专用能力"。
 *
 * 现在关键帧声明了 collectionWrite，写入走正式服务。这几条用例守的是这条路真的通。
 */
describe('三维关键帧集合写入', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      // 关键帧只在专业模式下成立：简易模式的时间轴由镜头卡编译，直写的关键帧会被覆盖。
      // 这几条用例原本全都跑在 simple 上——恰好是这个功能静默失效的那个模式。
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '关键帧测试' })
  })

  function cubeId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.id
  }

  it('能给物体写出一段上下漂浮的位移关键帧', async () => {
    const objectId = cubeId()
    const result = await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: 1, value: 1.1 },
      { objectId, propertyPath: 'transform.position.y', time: 2, value: 0.5 },
    ])

    expect(result.createdCount).toBe(3)
    const track = useCameraStageStore.getState().animation.tracks
      .find((item) => item.objectId === objectId && item.propertyPath === 'transform.position.y')
    expect(track?.keyframes).toHaveLength(3)
    // 时间轴必须长到装得下最后一个关键帧，否则动画被悄悄截断
    expect(useCameraStageStore.getState().animation.duration).toBeGreaterThanOrEqual(2)
  })

  it('对象 id 不存在时在写入之前被拒绝，并列出可用 id', async () => {
    const before = useCameraStageStore.getState().animation.tracks.length
    await expect(cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId: '立方体', propertyPath: 'transform.position.y', time: 0, value: 1 },
    ])).rejects.toThrow(cubeId())
    expect(useCameraStageStore.getState().animation.tracks).toHaveLength(before)
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('不可写属性路径被拒绝，不放开任意 store 写入', async () => {
    await expect(cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId: cubeId(), propertyPath: 'name', time: 0, value: 1 },
    ])).rejects.toThrow('KEYFRAME_PROPERTY_PATH_INVALID')
  })

  it('批量里有一条非法就整批不写', async () => {
    const objectId = cubeId()
    await expect(cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: -1, value: 1 },
    ])).rejects.toThrow('KEYFRAME_TIME_INVALID')
    expect(useCameraStageStore.getState().animation.tracks).toHaveLength(0)
  })

  it('写入的关键帧可以按引用删除', async () => {
    const objectId = cubeId()
    await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: 1, value: 1.1 },
    ])
    const result = await cameraStageKeyframeService.removeKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 1 },
    ])
    expect(result.removedCount).toBe(1)
    const track = useCameraStageStore.getState().animation.tracks
      .find((item) => item.objectId === objectId && item.propertyPath === 'transform.position.y')
    expect(track?.keyframes).toHaveLength(1)
  })
})

/**
 * 2.5：整条清空动画轨道。以前只能逐条列举关键帧再删——条数多时撞 `maxItemsPerChange` 上限，
 * 而且啰嗦。`clearTracks` 是正式入口，委托给领域层早就完整的 `store.clearTrack`（未重写）。
 */
describe('三维动画轨道整条清空', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      // 关键帧只在专业模式下成立：简易模式的时间轴由镜头卡编译，直写的关键帧会被覆盖。
      // 这几条用例原本全都跑在 simple 上——恰好是这个功能静默失效的那个模式。
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '轨道清空测试' })
  })

  function cubeId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.id
  }

  it('能一次清空一条轨道，不影响同对象的其他轨道', async () => {
    const objectId = cubeId()
    await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: 1, value: 1.1 },
      { objectId, propertyPath: 'transform.position.x', time: 0, value: 0 },
      { objectId, propertyPath: 'transform.position.x', time: 1, value: 2 },
    ])

    const result = await cameraStageKeyframeService.clearTracks('project-1', [
      { objectId, propertyPath: 'transform.position.y' },
    ])

    expect(result.clearedCount).toBe(1)
    const tracks = useCameraStageStore.getState().animation.tracks
    expect(tracks.find((track) => track.objectId === objectId && track.propertyPath === 'transform.position.y')).toBeUndefined()
    expect(tracks.find((track) => track.objectId === objectId && track.propertyPath === 'transform.position.x')?.keyframes).toHaveLength(2)
  })

  it('轨道不存在时拒绝，不改动场景', async () => {
    const objectId = cubeId()
    await expect(cameraStageKeyframeService.clearTracks('project-1', [
      { objectId, propertyPath: 'transform.position.y' },
    ])).rejects.toThrow('KEYFRAME_TRACK_NOT_FOUND')
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('不可写属性路径被拒绝', async () => {
    await expect(cameraStageKeyframeService.clearTracks('project-1', [
      { objectId: cubeId(), propertyPath: 'name' },
    ])).rejects.toThrow('KEYFRAME_PROPERTY_PATH_INVALID')
  })
})

/** 集合执行器按引用的段数区分"删单个关键帧"与"清空整条轨道"，两种粒度不能在同一批混用。 */
describe('三维关键帧集合执行器：轨道级引用与关键帧级引用', () => {
  let revision = 1
  const executor = new CameraStageKeyframeCollectionExecutor({
    readRevision: () => revision,
    bumpRevision: () => { revision += 1 },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera, cube],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      // 关键帧只在专业模式下成立：简易模式的时间轴由镜头卡编译，直写的关键帧会被覆盖。
      // 这几条用例原本全都跑在 simple 上——恰好是这个功能静默失效的那个模式。
      editorMode: 'pro',
      shots: [],
    }, { id: 'project-1', name: '轨道级引用测试' })
  })

  function cubeId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.id
  }

  function removeStep(targets: Array<{ id: string }>): Extract<ApplicationPlannedStep, { kind: 'collection' }> {
    return {
      kind: 'collection',
      entityType: CAMERA_STAGE_ENTITY_TYPES.keyframe,
      parent: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: 'project-1' },
      operation: { kind: 'remove', targets: targets.map((target) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.keyframe, id: target.id })) },
    } as Extract<ApplicationPlannedStep, { kind: 'collection' }>
  }

  it('三段引用（工程:对象:属性路径）清空整条轨道', async () => {
    const objectId = cubeId()
    await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: 1, value: 1.1 },
    ])

    const result = await executor.apply(removeStep([{ id: `project-1:${objectId}:transform.position.y` }]))

    expect(result.evidence[0]?.fact).toContain('已清空 1 条动画轨道')
    expect(useCameraStageStore.getState().animation.tracks).toHaveLength(0)
  })

  it('四段引用（带时间）仍然按单个关键帧删除', async () => {
    const objectId = cubeId()
    await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
      { objectId, propertyPath: 'transform.position.y', time: 1, value: 1.1 },
    ])

    const result = await executor.apply(removeStep([{ id: `project-1:${objectId}:transform.position.y:1` }]))

    expect(result.evidence[0]?.fact).toContain('已删除 1 个关键帧')
    expect(useCameraStageStore.getState().animation.tracks[0]?.keyframes).toHaveLength(1)
  })

  it('同一批混用轨道级与关键帧级引用被拒绝', async () => {
    const objectId = cubeId()
    await expect(executor.apply(removeStep([
      { id: `project-1:${objectId}:transform.position.y` },
      { id: `project-1:${objectId}:transform.position.x:0` },
    ]))).rejects.toThrow('MIXED_REMOVE_TARGETS_NOT_SUPPORTED')
  })

  /*
   * 回归：简易模式下写关键帧是**静默数据丢失**。
   *
   * 简易模式里镜头卡才是时间轴，shotSlice 有 14 处 `animation: compile(shots, objects)`——
   * 任何一次镜头卡改动都会把直写的关键帧整个覆盖掉；bakeToProMode 同样从镜头卡重编译，
   * 也不保留；play() 在简易模式只看镜头卡数量，所以这些关键帧连播都播不出来。
   *
   * 三件事叠加：助手写完、拿到成功回执、告诉用户"动画做好了"，而场景里什么都没发生。
   * 这比直接失败糟得多——失败至少还能改道。
   *
   * 上面几条用例此前全都跑在 simple 上，正是这个功能静默失效的那个模式，所以一直全绿。
   */
  it('简易模式下写关键帧必须被拒绝，并给出真的能做出动画的那条路', async () => {
    useCameraStageStore.setState({ editorMode: 'simple' })
    const objectId = cubeId()
    const attempt = cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
    ])

    await expect(attempt).rejects.toThrow('KEYFRAME_REQUIRES_PRO_MODE')
    /*
     * 这条提示的第一版把助手指向了「用 camera_stage.shot 的集合写入建镜头卡来做动画」——
     * 那是错的，实测助手照着做了十几轮也没做出动画：建卡只是录下**当前**姿态，中间不改姿态
     * 三张卡就一模一样。改道给错方向比不给还糟，它把模型的重试全引到了死路上。
     *
     * 正确配方是「挪播放头 → 改姿态」，两个字段都必须点名到位。
     */
    await expect(attempt).rejects.toThrow(/camera_stage\.playback/)
    await expect(attempt).rejects.toThrow(/current_time/)
    await expect(attempt).rejects.toThrow(/transform\.position/)
    await expect(attempt).rejects.toThrow(/bake_camera_stage_to_pro/)
    // 关键：被拒绝时一个关键帧都不许落下，否则拒绝本身又变成了半写状态。
    expect(useCameraStageStore.getState().animation.tracks).toHaveLength(0)
  })

  it('简易模式下删除与清空同样被拒绝', async () => {
    const objectId = cubeId()
    await cameraStageKeyframeService.createKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0, value: 0.5 },
    ])
    useCameraStageStore.setState({ editorMode: 'simple' })

    await expect(cameraStageKeyframeService.removeKeyframes('project-1', [
      { objectId, propertyPath: 'transform.position.y', time: 0 },
    ])).rejects.toThrow('KEYFRAME_REQUIRES_PRO_MODE')
    await expect(cameraStageKeyframeService.clearTracks('project-1', [
      { objectId, propertyPath: 'transform.position.y' },
    ])).rejects.toThrow('KEYFRAME_REQUIRES_PRO_MODE')
  })
})
