import { useCallback, useSyncExternalStore } from 'react'
import { findCameraStageProjectInstance, saveCameraStageProjectRuntime, type CameraStageSaveState } from '../application/cameraStageProjectRuntime'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 保存由实例负责；界面只订阅结果，卸载不会销毁计时器或队列。 */
export function useCameraStageAutosave(): { saveState: CameraStageSaveState; flushAutosave: () => Promise<void> } {
  const projectId = useCameraStageStore(state => state.currentProjectId)
  const instance = projectId ? findCameraStageProjectInstance(projectId) : undefined
  const subscribe = useCallback((notify: () => void) => instance?.status.subscribe(notify) ?? (() => undefined), [instance])
  const snapshot = useCallback(() => instance?.status.getState().state ?? 'idle', [instance])
  const saveState = useSyncExternalStore(subscribe, snapshot, snapshot)
  const flushAutosave = useCallback(async () => { if (instance) await saveCameraStageProjectRuntime(instance.id) }, [instance])
  return { saveState, flushAutosave }
}
