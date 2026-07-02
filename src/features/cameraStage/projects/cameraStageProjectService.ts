import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/core/logging'
import {
  deleteCameraStageProjectRecord,
  getCameraStageProjectRecord,
  listCameraStageProjectSummaries,
  renameCameraStageProjectRecord,
  upsertCameraStageProjectRecord,
} from '@/commands/cameraStageProjects'
import type {
  CameraStageProjectPlatformRecord,
  CameraStageProjectPlatformSummary,
} from '@/platform/contracts/cameraStageProjects'
import { deserializeScene, serializeScene } from '../domain/sceneSerialization'
import {
  CAMERA_STAGE_DEFAULT_PROJECT_NAME,
  clearCameraStageHistory,
  useCameraStageStore,
} from '../store/cameraStageStore'

/**
 * 运镜控制工程编排：把 store 中的场景数据与持久化命令桥打通。
 * 组件只调用这里的函数，不直接碰序列化/命令桥，保持编排逻辑单点落地。
 */

const logger = createLogger('cameraStage.projects')

export interface SavedProjectInfo {
  id: string
  name: string
}

/** 保存当前场景为工程；新场景自动生成 id，返回保存后的工程标识 */
export async function saveCurrentProject(): Promise<SavedProjectInfo> {
  const state = useCameraStageStore.getState()
  const now = Date.now()
  const id = state.currentProjectId ?? uuidv4()
  const name = state.currentProjectName.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME
  const sceneJson = serializeScene({ objects: state.objects, activeCameraId: state.activeCameraId })

  const record: CameraStageProjectPlatformRecord = {
    id,
    name,
    createdAt: now, // upsert 冲突更新时不覆盖 created_at，仅新建时生效
    updatedAt: now,
    objectCount: state.objects.length,
    sceneJson,
  }
  try {
    await upsertCameraStageProjectRecord(record)
  } catch (error) {
    logger.error('[cameraStage] 保存工程失败', error, { projectId: id })
    throw error
  }
  useCameraStageStore.getState().bindProject(id, name)
  return { id, name }
}

/** 新建空白工程：重置为空场景并立即保存入库，返回新工程标识 */
export async function createNewProject(
  name: string = CAMERA_STAGE_DEFAULT_PROJECT_NAME,
): Promise<SavedProjectInfo> {
  useCameraStageStore.getState().newScene(name)
  clearCameraStageHistory()
  return await saveCurrentProject()
}

/** 加载指定工程到场景，成功返回 true；工程不存在返回 false */
export async function loadProjectIntoScene(projectId: string): Promise<boolean> {
  const record = await getCameraStageProjectRecord(projectId)
  if (!record) {
    return false
  }
  const snapshot = deserializeScene(record.sceneJson)
  useCameraStageStore.getState().loadSnapshot(
    { objects: snapshot.objects, activeCameraId: snapshot.activeCameraId },
    { id: record.id, name: record.name },
  )
  clearCameraStageHistory()
  return true
}

export async function listProjects(): Promise<CameraStageProjectPlatformSummary[]> {
  return await listCameraStageProjectSummaries()
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const trimmed = name.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME
  await renameCameraStageProjectRecord(projectId, trimmed, Date.now())
  const state = useCameraStageStore.getState()
  if (state.currentProjectId === projectId) {
    state.bindProject(projectId, trimmed)
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteCameraStageProjectRecord(projectId)
}
