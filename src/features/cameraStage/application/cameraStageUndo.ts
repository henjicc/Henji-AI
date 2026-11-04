import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { useCameraStageStore, type CameraStageOwnedStore } from '../store/cameraStageStore'
import { createLogger } from '@/core/logging'
import { ApplicationExecutionProgressFailure, applicationFailureReason } from '@/core/application-control/execution/persistence'

const logger = createLogger('features.cameraStage.application')

interface CameraStageUndoSnapshot {
  project: { id: string; name: string }
  storeIdentity: symbol
  history: Pick<ReturnType<CameraStageOwnedStore['temporal']['getState']>, 'pastStates' | 'futureStates'>
  scene: Pick<
    ReturnType<typeof useCameraStageStore.getState>,
    'objects' | 'activeCameraId' | 'animation' | 'sceneSettings' | 'stateKeyframes' | 'sets' | 'cameraCuts' | 'coverages'
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
      cameraCuts: state.cameraCuts,
      coverages: state.coverages,
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

/**
 * 写入失败后恢复到快照；恢复成功就返回，由调用方抛出原始错误。
 * 恢复也失败时场景还留着这次写入：带着原始错误抛出进度失败，引擎据此报告“已执行未补偿”，
 * 不会把它说成没有任何步骤被提交、可以直接重试。
 */
export async function rollbackCameraStageWrite(projectId: string, undoToken: string, error: unknown, event = 'camera_stage.write.rollback_failed'): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维场景写入回滚失败', rollbackError, { event, projectId, writeError: applicationFailureReason(error) })
    throw new ApplicationExecutionProgressFailure(`${applicationFailureReason(error)}；回滚未完成：${applicationFailureReason(rollbackError)}`,
      [{ status: 'completed', resultingRevisions: {}, directRefs: [], evidence: [] }], [], error)
  }
}

/** 抓快照之后的写入、存盘与核对：任何一步失败都先恢复到快照再抛出，否则场景已改却报未执行，重试会叠出重复内容。 */
export async function afterCameraStageWrite<T>(projectId: string, undoToken: string, work: () => T | Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    await rollbackCameraStageWrite(projectId, undoToken, error)
    throw error
  }
}

export function forgetCameraStageUndo(token: string): void {
  undoSnapshots.delete(token)
}
