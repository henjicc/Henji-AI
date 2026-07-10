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
import type { StageEditorMode } from '../domain/shotTypes'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
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

export interface CameraStageProjectDraft {
  id: string
  name: string
  record: CameraStageProjectPlatformRecord
  fingerprint: string
}

function createDraftFingerprint(projectId: string, name: string, sceneJson: string): string {
  return `${projectId}\u0000${name}\u0000${sceneJson}`
}

/** 基于当前 store 场景生成一份待保存工程草稿，供手动保存/自动保存共用。 */
export function createCurrentProjectDraft(now: number = Date.now()): CameraStageProjectDraft {
  const state = useCameraStageStore.getState()
  const id = state.currentProjectId ?? uuidv4()
  const name = state.currentProjectName.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME
  const sceneJson = serializeScene({
    objects: state.objects,
    activeCameraId: state.activeCameraId,
    animation: state.animation,
    sceneSettings: state.sceneSettings,
    editorMode: state.editorMode,
    shots: state.shots,
  })

  const record: CameraStageProjectPlatformRecord = {
    id,
    name,
    createdAt: now, // upsert 冲突更新时不覆盖 created_at，仅新建时生效
    updatedAt: now,
    objectCount: state.objects.length,
    sceneJson,
  }
  return {
    id,
    name,
    record,
    fingerprint: createDraftFingerprint(id, name, sceneJson),
  }
}

/** 持久化工程草稿并把工程 id/name 绑定回当前编辑态。 */
export async function saveProjectDraft(draft: CameraStageProjectDraft): Promise<SavedProjectInfo> {
  try {
    await upsertCameraStageProjectRecord(draft.record)
  } catch (error) {
    logger.error('[cameraStage] 保存工程失败', error, { projectId: draft.id })
    throw error
  }
  useCameraStageStore.getState().bindProject(draft.id, draft.name)
  useCameraStageSessionStore.getState().setLastProjectId(draft.id)
  return { id: draft.id, name: draft.name }
}

/** 保存当前场景为工程；新场景自动生成 id，返回保存后的工程标识 */
export async function saveCurrentProject(): Promise<SavedProjectInfo> {
  return await saveProjectDraft(createCurrentProjectDraft())
}

/** 将当前简易工程单向烘焙为专业工程，并立即持久化。 */
export async function bakeCurrentProjectToPro(): Promise<SavedProjectInfo | null> {
  const before = useCameraStageStore.getState()
  if (before.editorMode !== 'simple') return null
  const shotCount = before.shots.length
  logger.info('简易工程烘焙开始', {
    event: 'simple_mode.bake.start',
    projectId: before.currentProjectId,
    shotCount,
  })
  before.bakeToProMode()
  clearCameraStageHistory()
  const baked = useCameraStageStore.getState()
  try {
    const project = await saveCurrentProject()
    logger.info('简易工程烘焙完成', {
      event: 'simple_mode.bake.completed',
      projectId: project.id,
      shotCount,
      trackCount: baked.animation.tracks.length,
    })
    return project
  } catch (error) {
    logger.error('简易工程烘焙保存失败', error, {
      event: 'simple_mode.bake.failed',
      projectId: baked.currentProjectId,
      shotCount,
      trackCount: baked.animation.tracks.length,
    })
    throw error
  }
}

/** 新建空白工程：重置为空场景并立即保存入库，返回新工程标识 */
export async function createNewProject(
  name: string = CAMERA_STAGE_DEFAULT_PROJECT_NAME,
  mode: StageEditorMode = 'simple',
): Promise<SavedProjectInfo> {
  logger.info('新建运镜工程开始', { event: 'camera_stage.project.create.start', mode })
  useCameraStageStore.getState().newScene(name)
  useCameraStageStore.getState().setEditorMode(mode)
  useCameraStageSessionStore.getState().setLastProjectId(null)
  clearCameraStageHistory()
  try {
    const project = await saveCurrentProject()
    logger.info('新建运镜工程完成', {
      event: 'camera_stage.project.create.completed',
      projectId: project.id,
      mode,
    })
    return project
  } catch (error) {
    logger.error('新建运镜工程失败', error, {
      event: 'camera_stage.project.create.failed',
      mode,
    })
    throw error
  }
}

/** 加载指定工程到场景，成功返回 true；工程不存在返回 false */
export async function loadProjectIntoScene(projectId: string): Promise<boolean> {
  const record = await getCameraStageProjectRecord(projectId)
  if (!record) {
    return false
  }
  const snapshot = deserializeScene(record.sceneJson)
  useCameraStageStore.getState().loadSnapshot(
    {
      objects: snapshot.objects,
      activeCameraId: snapshot.activeCameraId,
      animation: snapshot.animation,
      sceneSettings: snapshot.sceneSettings,
      editorMode: snapshot.editorMode,
      shots: snapshot.shots,
    },
    { id: record.id, name: record.name },
  )
  useCameraStageSessionStore.getState().setLastProjectId(record.id)
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
  const session = useCameraStageSessionStore.getState()
  if (session.lastProjectId === projectId) {
    session.setLastProjectId(null)
  }
}
