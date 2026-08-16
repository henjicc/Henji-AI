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
import { cameraStageStateKeyframeService } from './cameraStageStateKeyframeService'

/**
 * 「状态关键帧删不掉也排不了序」以前无解：`camera_stage.state_keyframe` 的实体、属性、mutation 执行器全都
 * 注册齐了，助手能加（专用能力 add_camera_stage_stateKeyframe）能改，却建不出对应的批量创建/删除路径——
 * 新建只能一张一张来，删除、批量删除完全没有入口。
 *
 * 现在状态关键帧声明了 collectionWrite，创建/删除都走这个正式服务。这几条用例守的是这条路真的通，
 * 而且 store 侧原有的删除逻辑（选中态回退、过渡时长重算）没有被重写、行为不变。
 */
describe('三维状态关键帧集合写入', () => {
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
    }, { id: 'project-1', name: '状态关键帧集合写入测试' })
  })

  function cameraId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'camera')!.id
  }

  function cubeId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.id
  }

  function cubeYInStateKeyframe(stateKeyframeId: string): number | undefined {
    const stateKeyframe = useCameraStageStore.getState().stateKeyframes.find((candidate) => candidate.id === stateKeyframeId)
    return stateKeyframe?.objectStates[cubeId()]?.transform.position.y
  }

  /**
   * 状态关键帧模式做动画的**唯一正确配方**，钉死在这里。
   *
   * 实测助手连撞十几次都没做出动画，因为它以为「建三张卡」就是做动画——建卡只是在某个时间点
   * 录下**当前**姿态，三次都不动物体，三张卡自然一模一样，播放起来纹丝不动。
   *
   * 真正的配方和人在界面上做的一样：**把播放头挪到 T，再拖物体**——`compileSimpleEdit` 会在
   * T 自动记一张状态卡（AE 式自动打点）。建卡与改姿态是两件事，不要指望建卡顺带改姿态。
   *
   * 这条是功能证明而不是格式检查：直接读三张卡里球的 y，值必须真的不同。
   */
  it('挪播放头再改姿态，状态关键帧模式自动记下三张不同的状态卡', () => {
    const cube = cubeId()

    // t=0 低位
    useCameraStageStore.getState().seek(0)
    useCameraStageStore.getState().updateTransform(cube, { position: { x: 0, y: 0.5, z: 0 } })
    // t=1 高位
    useCameraStageStore.getState().seek(1)
    useCameraStageStore.getState().updateTransform(cube, { position: { x: 0, y: 2.5, z: 0 } })
    // t=2 回落
    useCameraStageStore.getState().seek(2)
    useCameraStageStore.getState().updateTransform(cube, { position: { x: 0, y: 0.5, z: 0 } })

    const stateKeyframes = useCameraStageStore.getState().stateKeyframes
    expect(stateKeyframes.length, '每个时间点都该自动记下一张状态卡').toBeGreaterThanOrEqual(3)
    const yByTime = new Map(stateKeyframes.map((stateKeyframe) => [
      Math.round(stateKeyframe.time * 100) / 100,
      stateKeyframe.objectStates[cube]?.transform.position.y,
    ]))
    expect(yByTime.get(0)).toBeCloseTo(0.5, 2)
    expect(yByTime.get(1), '中间那张卡没记下高位，播放起来是不动的').toBeCloseTo(2.5, 2)
    expect(yByTime.get(2)).toBeCloseTo(0.5, 2)
  })

  it('建卡只录当前姿态，不动物体就三张卡全一样——这不是做动画的路子', async () => {
    const cube = cubeId()
    useCameraStageStore.getState().updateTransform(cube, { position: { x: 0, y: 0.5, z: 0 } })
    const created = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0 }, { time: 1 }, { time: 2 },
    ])

    const ys = created.stateKeyframeIds.map((id) => cubeYInStateKeyframe(id))
    // 钉住这个事实本身：助手误以为建卡就是做动画，正是从这里开始白忙一整轮的
    expect(new Set(ys).size, '建卡本身不产生差异，动画必须靠改姿态').toBe(1)
  })

  it('能按指定时间新建一张状态关键帧', async () => {
    const result = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 1.5, name: '开场' },
    ])

    expect(result.stateKeyframeIds).toHaveLength(1)
    const stateKeyframe = useCameraStageStore.getState().stateKeyframes.find((candidate) => candidate.id === result.stateKeyframeIds[0])
    expect(stateKeyframe?.time).toBeCloseTo(1.5, 2)
    expect(stateKeyframe?.name).toBe('开场')
    expect(mocks.saveCurrentProject).toHaveBeenCalled()
  })

  it('能批量新建多张状态关键帧，各自落在指定时间点上', async () => {
    const result = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0, name: '开场' },
      { time: 1, name: '中段' },
      { time: 2, name: '结尾', cameraId: cameraId() },
    ])

    expect(result.stateKeyframeIds).toHaveLength(3)
    const stateKeyframes = useCameraStageStore.getState().stateKeyframes
    expect(stateKeyframes).toHaveLength(3)
    expect(stateKeyframes.map((stateKeyframe) => stateKeyframe.time)).toEqual([0, 1, 2])
    expect(stateKeyframes.find((stateKeyframe) => stateKeyframe.name === '结尾')?.cameraId).toBe(cameraId())
  })

  it('摄像机引用不存在时在写入之前被拒绝，不新建任何卡', async () => {
    await expect(cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0, cameraId: '不存在的摄像机' },
    ])).rejects.toThrow('STATE_KEYFRAME_CAMERA_NOT_FOUND')
    expect(useCameraStageStore.getState().stateKeyframes).toHaveLength(0)
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('批量新建里有一条非法就整批不写', async () => {
    await expect(cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0, name: '开场' },
      { time: -1, name: '非法时间' },
    ])).rejects.toThrow('STATE_KEYFRAME_TIME_INVALID')
    expect(useCameraStageStore.getState().stateKeyframes).toHaveLength(0)
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled()
  })

  it('能删除一张状态关键帧', async () => {
    const created = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0 }, { time: 1 },
    ])
    const result = await cameraStageStateKeyframeService.removeStateKeyframes('project-1', [created.stateKeyframeIds[0]])

    expect(result.removedCount).toBe(1)
    expect(useCameraStageStore.getState().stateKeyframes).toHaveLength(1)
  })

  it('能批量删除状态关键帧', async () => {
    const created = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0 }, { time: 1 }, { time: 2 },
    ])
    const result = await cameraStageStateKeyframeService.removeStateKeyframes('project-1', created.stateKeyframeIds.slice(0, 2))

    expect(result.removedCount).toBe(2)
    expect(useCameraStageStore.getState().stateKeyframes).toHaveLength(1)
  })

  it('批量删除中一条 id 不存在就整批不写', async () => {
    const created = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0 }, { time: 1 },
    ])
    await expect(cameraStageStateKeyframeService.removeStateKeyframes('project-1', [
      created.stateKeyframeIds[0], '不存在的状态关键帧',
    ])).rejects.toThrow('STATE_KEYFRAME_NOT_FOUND')
    expect(useCameraStageStore.getState().stateKeyframes).toHaveLength(2)
  })

  it('删除后过渡时长按剩余状态关键帧正确重算，复用 store 原有逻辑', async () => {
    const created = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [
      { time: 0 }, { time: 2 }, { time: 5 },
    ])
    await cameraStageStateKeyframeService.removeStateKeyframes('project-1', [created.stateKeyframeIds[1]])

    const remaining = useCameraStageStore.getState().stateKeyframes
    expect(remaining.map((stateKeyframe) => stateKeyframe.time)).toEqual([0, 5])
    // 第一张卡的过渡时长必须重算为到新的下一张卡（5秒）的间隔，而不是残留旧值（2秒）。
    expect(remaining[0].transitionDuration).toBeCloseTo(5, 2)
  })

})
