import { useStore } from 'zustand'
import { useCameraStageStore } from './cameraStageStore'

/**
 * 3D 镜头参考撤销/重做：暴露 undo/redo 动作与可用状态（响应式订阅 zundo temporal store）。
 */

export interface CameraStageHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export function useCameraStageHistory(): CameraStageHistory {
  const canUndo = useStore(useCameraStageStore.temporal, (state) => state.pastStates.length > 0)
  const canRedo = useStore(useCameraStageStore.temporal, (state) => state.futureStates.length > 0)
  const undo = useStore(useCameraStageStore.temporal, state => state.undo)
  const redo = useStore(useCameraStageStore.temporal, state => state.redo)
  return { canUndo, canRedo, undo, redo }
}
