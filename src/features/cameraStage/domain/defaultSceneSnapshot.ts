import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import type { StageSceneSnapshotInput } from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'

export interface DefaultCameraStageSceneSnapshot extends StageSceneSnapshotInput {
  defaultCameraId: string
  defaultStateKeyframeId: string
}

/**
 * 新工程唯一的默认场景工厂。UI 新建与后台持久化都从这里取得完全相同的摄像机和首关键帧，
 * 调用本函数只构造纯领域数据，不修改当前编辑会话、导航或撤销历史。
 */
export function createDefaultCameraStageSceneSnapshot(): DefaultCameraStageSceneSnapshot {
  const camera = createCameraObject('摄像机01', pickDefaultColor(0))
  const objects = [camera]
  const stateKeyframe = createStateKeyframe(objects, '关键帧 1', camera.id)
  return {
    objects,
    activeCameraId: camera.id,
    sceneSettings: createDefaultSceneSettings(),
    stateKeyframes: [stateKeyframe],
    defaultCameraId: camera.id,
    defaultStateKeyframeId: stateKeyframe.id,
  }
}
