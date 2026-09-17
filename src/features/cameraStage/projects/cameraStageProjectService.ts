import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/core/logging'
import { getCameraStageProjectRecord, listCameraStageProjectSummaries } from '@/commands/cameraStageProjects'
import type { CameraStageProjectPlatformSummary } from '@/platform/contracts/cameraStageProjects'
import { deserializeScene, isCurrentCameraStageScene, serializeScene } from '../domain/sceneSerialization'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import { CAMERA_STAGE_DEFAULT_PROJECT_NAME } from '../store/cameraStageStore'
import { removeCameraStageProject, writeCameraStageProject } from './cameraStageProjectPersistence'
import {
  attachCameraStageProject, cameraStageProjectStore, closeCameraStageProjectInstance,
  leaseCameraStageProjectRuntime, readCameraStageProjectInstance,
  registerCameraStageProjectInstance, saveCameraStageProjectRuntime,
} from '../application/cameraStageProjectRuntime'

const logger = createLogger('cameraStage.projects')

export interface SavedProjectInfo { id: string; name: string }
export interface CreatedCameraStageProjectInfo extends SavedProjectInfo {
  defaultCameraId: string
  defaultStateKeyframeId: string
}

/** 创建领域实例并保存，不切换当前页面。 */
export async function createStoredCameraStageProject(name = CAMERA_STAGE_DEFAULT_PROJECT_NAME): Promise<CreatedCameraStageProjectInfo> {
  const id = uuidv4()
  const now = Date.now()
  const projectName = name.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME
  const snapshot = createDefaultCameraStageSceneSnapshot()
  const sceneJson = serializeScene(snapshot)
  await writeCameraStageProject({ id, name: projectName, createdAt: now, updatedAt: now, objectCount: snapshot.objects.length, sceneJson })
  registerCameraStageProjectInstance({ ...deserializeScene(sceneJson), id, name: projectName, createdAt: now, updatedAt: now })
  return { id, name: projectName, defaultCameraId: snapshot.defaultCameraId, defaultStateKeyframeId: snapshot.defaultStateKeyframeId }
}

/** 同步画布输入到目标工程实例，保留尚未落盘的其他编辑。 */
export async function applyProjectEnvironmentImage(projectId: string, environmentImageUrl: string | null): Promise<void> {
  const release = await leaseCameraStageProjectRuntime(projectId)
  try {
    const state = cameraStageProjectStore(projectId).getState()
    if (state.sceneSettings.sky.environmentImageUrl !== environmentImageUrl) state.setSceneEnvironmentImageUrl(environmentImageUrl)
    await saveCameraStageProjectRuntime(projectId)
  } catch (error) {
    logger.error('同步 3D 全景环境失败', error, { event: 'camera_stage.project.environment_sync.failed', projectId })
    throw error
  } finally { release() }
}

/** 界面新建入口：创建后明确附着目标实例。 */
export async function createNewProject(name = CAMERA_STAGE_DEFAULT_PROJECT_NAME): Promise<SavedProjectInfo> {
  const project = await createStoredCameraStageProject(name)
  await attachCameraStageProject(project.id)
  cameraStageProjectStore(project.id).getState().setViewMode('camera')
  const session = useCameraStageSessionStore.getState()
  session.setLastProjectId(project.id)
  session.setStageViewMode('camera')
  return project
}

export async function cloneCameraStageProject(projectId: string, name?: string): Promise<SavedProjectInfo | null> {
  let release: () => void
  try { release = await leaseCameraStageProjectRuntime(projectId) }
  catch (error) { if (error instanceof Error && error.message === 'NOT_FOUND') return null; throw error }
  try {
    const snapshot = readCameraStageProjectInstance(projectId)
    const id = uuidv4()
    const now = Date.now()
    const nextName = name?.trim() || `${snapshot.name} 副本`
    const sceneJson = serializeScene(snapshot)
    await writeCameraStageProject({ id, name: nextName, sceneJson, objectCount: snapshot.objects.length, createdAt: now, updatedAt: now })
    registerCameraStageProjectInstance({ ...deserializeScene(sceneJson), id, name: nextName, createdAt: now, updatedAt: now })
    return { id, name: nextName }
  } finally { release() }
}

/** 打开只附着原实例，不等待网络任务、不覆盖状态或清空撤销。 */
export async function loadProjectIntoScene(projectId: string, options: { updateSession?: boolean } = {}): Promise<boolean> {
  try { await attachCameraStageProject(projectId) }
  catch (error) { if (error instanceof Error && error.message === 'NOT_FOUND') return false; throw error }
  if (options.updateSession !== false) useCameraStageSessionStore.getState().setLastProjectId(projectId)
  return true
}

export async function listProjects(): Promise<CameraStageProjectPlatformSummary[]> {
  const summaries = await listCameraStageProjectSummaries()
  const checked = await Promise.all(summaries.map(async summary => {
    const record = await getCameraStageProjectRecord(summary.id)
    return record && isCurrentCameraStageScene(record.sceneJson) ? summary : null
  }))
  return checked.filter((summary): summary is CameraStageProjectPlatformSummary => summary !== null)
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const release = await leaseCameraStageProjectRuntime(projectId)
  try {
    cameraStageProjectStore(projectId).getState().bindProject(projectId, name.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME)
    await saveCameraStageProjectRuntime(projectId)
  } finally { release() }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    await closeCameraStageProjectInstance(projectId, () => removeCameraStageProject(projectId))
    const session = useCameraStageSessionStore.getState()
    if (session.lastProjectId === projectId) session.setLastProjectId(null)
  } catch (error) {
    logger.error('删除运镜工程失败', error, { event: 'camera_stage.project.delete.failed', projectId })
    throw error
  }
}
