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
import { cameraStageShotService } from './cameraStageShotService'

/**
 * 「镜头卡删不掉也排不了序」以前无解：`camera_stage.shot` 的实体、属性、mutation 执行器全都
 * 注册齐了，助手能加（专用能力 add_camera_stage_shot）能改，却建不出对应的批量创建/删除路径——
 * 新建只能一张一张来，删除、批量删除完全没有入口。
 *
 * 现在镜头卡声明了 collectionWrite，创建/删除都走这个正式服务。这几条用例守的是这条路真的通，
 * 而且 store 侧原有的删除逻辑（选中态回退、过渡时长重算）没有被重写、行为不变。
 */
describe('三维镜头卡集合写入', () => {
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
    }, { id: 'project-1', name: '镜头卡集合写入测试' })
  })

  function cameraId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'camera')!.id
  }

  it('能按指定时间新建一张镜头卡', async () => {
    const result = await cameraStageShotService.createShots('project-1', [
      { time: 1.5, name: '开场' },
    ])

    expect(result.shotIds).toHaveLength(1)
    const shot = useCameraStageStore.getState().shots.find((candidate) => candidate.id === result.shotIds[0])
    expect(shot?.time).toBeCloseTo(1.5, 2)
    expect(shot?.name).toBe('开场')
    expect(mocks.saveCurrentProject).toHaveBeenCalled()
  })

  it('能批量新建多张镜头卡，各自落在指定时间点上', async () => {
    const result = await cameraStageShotService.createShots('project-1', [
      { time: 0, name: '开场' },
      { time: 1, name: '中段' },
      { time: 2, name: '结尾', cameraId: cameraId() },
    ])

    expect(result.shotIds).toHaveLength(3)
    const shots = useCameraStageStore.getState().shots
    expect(shots).toHaveLength(3)
    expect(shots.map((shot) => shot.time)).toEqual([0, 1, 2])
    expect(shots.find((shot) => shot.name === '结尾')?.cameraId).toBe(cameraId())
  })

  it('摄像机引用不存在时在写入之前被拒绝，不新建任何卡', async () => {
    await expect(cameraStageShotService.createShots('project-1', [
      { time: 0, cameraId: '不存在的摄像机' },
    ])).rejects.toThrow('SHOT_CAMERA_NOT_FOUND')
    expect(useCameraStageStore.getState().shots).toHaveLength(0)
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('批量新建里有一条非法就整批不写', async () => {
    await expect(cameraStageShotService.createShots('project-1', [
      { time: 0, name: '开场' },
      { time: -1, name: '非法时间' },
    ])).rejects.toThrow('SHOT_TIME_INVALID')
    expect(useCameraStageStore.getState().shots).toHaveLength(0)
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('能删除一张镜头卡', async () => {
    const created = await cameraStageShotService.createShots('project-1', [
      { time: 0 }, { time: 1 },
    ])
    const result = await cameraStageShotService.removeShots('project-1', [created.shotIds[0]])

    expect(result.removedCount).toBe(1)
    expect(useCameraStageStore.getState().shots).toHaveLength(1)
  })

  it('能批量删除镜头卡', async () => {
    const created = await cameraStageShotService.createShots('project-1', [
      { time: 0 }, { time: 1 }, { time: 2 },
    ])
    const result = await cameraStageShotService.removeShots('project-1', created.shotIds.slice(0, 2))

    expect(result.removedCount).toBe(2)
    expect(useCameraStageStore.getState().shots).toHaveLength(1)
  })

  it('批量删除中一条 id 不存在就整批不写', async () => {
    const created = await cameraStageShotService.createShots('project-1', [
      { time: 0 }, { time: 1 },
    ])
    await expect(cameraStageShotService.removeShots('project-1', [
      created.shotIds[0], '不存在的镜头卡',
    ])).rejects.toThrow('SHOT_NOT_FOUND')
    expect(useCameraStageStore.getState().shots).toHaveLength(2)
  })

  it('删除后过渡时长按剩余镜头卡正确重算，复用 store 原有逻辑', async () => {
    const created = await cameraStageShotService.createShots('project-1', [
      { time: 0 }, { time: 2 }, { time: 5 },
    ])
    await cameraStageShotService.removeShots('project-1', [created.shotIds[1]])

    const remaining = useCameraStageStore.getState().shots
    expect(remaining.map((shot) => shot.time)).toEqual([0, 5])
    // 第一张卡的过渡时长必须重算为到新的下一张卡（5秒）的间隔，而不是残留旧值（2秒）。
    expect(remaining[0].transitionDuration).toBeCloseTo(5, 2)
  })

  /*
   * 回归：专业模式下新建镜头卡会**销毁用户已有的关键帧时间轴**。
   *
   * `addShot` 的 patch 里带着 `animation: compile(shots, objects)`——这是简易模式的核心语义
   * （镜头卡是时间轴的唯一来源），但在专业模式下它等于把整条手工关键帧时间轴替换成"由一张
   * 镜头卡编译出来的结果"。用户几十条关键帧，一次调用全没。
   *
   * 人撞不到这个坑：带「新建镜头卡」按钮的 ShotTimelinePanel 只在简易模式渲染。也就是说这是
   * 一条只有助手走得到的破坏性路径——不设防就是人机能力"负对齐"：助手能做人做不到的破坏。
   */
  it('专业模式下新建镜头卡必须被拒绝，且不碰已有关键帧轨道', async () => {
    useCameraStageStore.setState({
      editorMode: 'pro',
      shots: [],
      animation: {
        ...useCameraStageStore.getState().animation,
        tracks: [{
          objectId: useCameraStageStore.getState().objects[1].id,
          propertyPath: 'transform.position.y',
          keyframes: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 1, value: 2, easing: 'linear' },
          ],
        }],
      },
    })

    await expect(cameraStageShotService.createShots('project-1', [{ time: 0 }]))
      .rejects.toThrow('SHOT_REQUIRES_SIMPLE_MODE')
    // 拒绝要给改道：专业模式下该走关键帧集合写入。
    await expect(cameraStageShotService.createShots('project-1', [{ time: 0 }]))
      .rejects.toThrow(/camera_stage\.keyframe/)
    // 最关键的一条：用户的轨道必须原封不动。
    expect(useCameraStageStore.getState().animation.tracks).toHaveLength(1)
    expect(useCameraStageStore.getState().animation.tracks[0].keyframes).toHaveLength(2)
  })
})
