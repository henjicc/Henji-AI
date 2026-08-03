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
import { cameraStageKeyframeService } from './cameraStageKeyframeService'

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
      editorMode: 'simple',
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
