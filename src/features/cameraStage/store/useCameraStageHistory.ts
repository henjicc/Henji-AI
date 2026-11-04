import { useStore } from 'zustand'
import { followSceneScaleFog } from '../application/stageSceneExtent'
import { cameraStageStoreAttachment, useCameraStageStore, type CameraStageOwnedStore } from './cameraStageStore'

/**
 * 3D 镜头参考撤销/重做：暴露 undo/redo 动作与可用状态（响应式订阅 zundo temporal store）。
 */

export interface CameraStageHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

/**
 * 撤销历史只记场景对象与关键帧，场景设置不在里面；生成、删除布景时跟着场景尺度改过的雾距，
 * 撤销重做时按同一条规则跟回去，否则撤掉城区后雾还停在一千多米，之后也不再跟随。
 */
export function stepCameraStageHistory(store: CameraStageOwnedStore, direction: 'undo' | 'redo'): void {
  const { objects: before, sets: beforeSets } = store.getState()
  store.temporal.getState()[direction]()
  const after = store.getState()
  // 只有布景生成、删除会改雾距，撤销重做也只在布景列表变了时跟随
  if (after.sets === beforeSets) return
  const fog = followSceneScaleFog(after.sceneSettings.fog, before, after.objects)
  if (fog !== after.sceneSettings.fog) store.setState({ sceneSettings: { ...after.sceneSettings, fog } })
}

const attachedStore = (): CameraStageOwnedStore => cameraStageStoreAttachment.getStore() as CameraStageOwnedStore
const undo = (): void => stepCameraStageHistory(attachedStore(), 'undo')
const redo = (): void => stepCameraStageHistory(attachedStore(), 'redo')

export function useCameraStageHistory(): CameraStageHistory {
  const canUndo = useStore(useCameraStageStore.temporal, (state) => state.pastStates.length > 0)
  const canRedo = useStore(useCameraStageStore.temporal, (state) => state.futureStates.length > 0)
  return { canUndo, canRedo, undo, redo }
}
