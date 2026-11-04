import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { useCameraStageStore, type CameraStageOwnedStore } from '../store/cameraStageStore'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.cameraStage.application')

interface CameraStageUndoSnapshot {
  project: { id: string; name: string }
  storeIdentity: symbol
  history: Pick<ReturnType<CameraStageOwnedStore['temporal']['getState']>, 'pastStates' | 'futureStates'>
  scene: Pick<
    ReturnType<typeof useCameraStageStore.getState>,
    'objects' | 'activeCameraId' | 'animation' | 'sceneSettings' | 'stateKeyframes' | 'sets'
  >
}

const undoSnapshots = new Map<string, CameraStageUndoSnapshot>()
// 与编辑器历史一样有界；过期回执通过 NOT_FOUND 明确拒绝，不保留无限场景副本。
const MAX_UNDO_SNAPSHOTS = 100

function undoToken(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `camera-stage-undo:${random}`
}

export function captureCameraStageUndo(projectId: string): string {
  const store = cameraStageProjectStore(projectId)
  const state = store.getState()
  if (state.currentProjectId !== projectId) throw new Error('STALE_CONTEXT')
  const token = undoToken()
  undoSnapshots.set(token, {
    project: { id: projectId, name: state.currentProjectName },
    storeIdentity: store.undoIdentity,
    history: {
      pastStates: [...store.temporal.getState().pastStates],
      futureStates: [...store.temporal.getState().futureStates],
    },
    scene: structuredClone({
      objects: state.objects,
      activeCameraId: state.activeCameraId,
      animation: state.animation,
      sceneSettings: state.sceneSettings,
      stateKeyframes: state.stateKeyframes,
      sets: state.sets,
    }),
  })
  while (undoSnapshots.size > MAX_UNDO_SNAPSHOTS) {
    const oldest = undoSnapshots.keys().next().value
    if (oldest !== undefined) undoSnapshots.delete(oldest)
  }
  return token
}

export async function restoreCameraStageUndo(token: string): Promise<{ projectId: string }> {
  const snapshot = undoSnapshots.get(token)
  if (!snapshot) throw new Error('NOT_FOUND')
  await ensureCameraStageProjectRuntime(snapshot.project.id)
  const store = cameraStageProjectStore(snapshot.project.id)
  const history = store.temporal.getState()
  const tracking = history.isTracking
  history.pause()
  try {
    store.restoreSceneContent(snapshot.scene)
    // 恢复原历史而非记录回滚 set，避免 Ctrl+Z/redo 复活事务失败中间态。
    store.temporal.setState(store.undoIdentity === snapshot.storeIdentity
      ? { pastStates: [...snapshot.history.pastStates], futureStates: [...snapshot.history.futureStates] }
      : { pastStates: [], futureStates: [] })
  } finally {
    if (tracking) history.resume()
  }
  await saveCameraStageProjectRuntime(snapshot.project.id)
  undoSnapshots.delete(token)
  return { projectId: snapshot.project.id }
}

/** 写入失败后恢复到快照。恢复再失败也不盖掉原始错误——原始错误才是调用方据以修正的那条，恢复失败单独记日志。 */
export async function rollbackCameraStageWrite(projectId: string, undoToken: string, event = 'camera_stage.write.rollback_failed'): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维场景写入回滚失败', rollbackError, { event, projectId })
  }
}

/**
 * 抓快照之后的写入、存盘与核对。引擎把单步内的失败记为“零步完成”，调用方据此可以直接重试；
 * 所以这里任何一步失败都先恢复到快照再抛出，否则场景已改却报未执行，重试会叠出重复内容。
 */
export async function afterCameraStageWrite<T>(projectId: string, undoToken: string, work: () => T | Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    await rollbackCameraStageWrite(projectId, undoToken)
    throw error
  }
}

export function forgetCameraStageUndo(token: string): void {
  undoSnapshots.delete(token)
}
