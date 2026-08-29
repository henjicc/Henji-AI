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
  CameraStageProjectPlatformSummary,
  CameraStageProjectPlatformWrite,
} from '@/platform/contracts/cameraStageProjects'
import { deserializeScene, isCurrentCameraStageScene, serializeScene } from '../domain/sceneSerialization'
import type { StageSceneAnimation } from '../domain/animationTypes'
import type { StageObject, StageSceneSettings } from '../domain/sceneTypes'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import {
  CAMERA_STAGE_DEFAULT_PROJECT_NAME,
  clearCameraStageHistory,
  useCameraStageStore,
} from '../store/cameraStageStore'

/**
 * 3D 镜头参考工程编排：把 store 中的场景数据与持久化命令桥打通。
 * 组件只调用这里的函数，不直接碰序列化/命令桥，保持编排逻辑单点落地。
 */

const logger = createLogger('cameraStage.projects')
const deletedProjectIds = new Set<string>()
const projectMutationTails = new Map<string, Promise<void>>()

/** 同一工程的保存/删除严格串行，避免编辑器卸载时的迟到 autosave 在删除后把记录复活。 */
async function enqueueProjectMutation(projectId: string, mutation: () => Promise<void>): Promise<void> {
  const previous = projectMutationTails.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(mutation)
  projectMutationTails.set(projectId, current)
  try {
    await current
  } finally {
    if (projectMutationTails.get(projectId) === current) projectMutationTails.delete(projectId)
  }
}

export interface SavedProjectInfo {
  id: string
  name: string
}

export interface CameraStageProjectDraft {
  id: string
  name: string
  record: CameraStageProjectPlatformWrite
  fingerprint: string
}

export interface CameraStageProjectSnapshot {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objects: StageObject[]
  activeCameraId: string | null
  animation: StageSceneAnimation
  sceneSettings: StageSceneSettings
  stateKeyframes: StageStateKeyframe[]
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
    sceneSettings: state.sceneSettings,
    stateKeyframes: state.stateKeyframes,
  })

  const record: CameraStageProjectPlatformWrite = {
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
export async function saveProjectDraft(
  draft: CameraStageProjectDraft,
  bindToCurrentProject = true,
): Promise<SavedProjectInfo> {
  if (deletedProjectIds.has(draft.id)) {
    logger.debug('跳过已删除工程的迟到保存', {
      event: 'camera_stage.project.save.skipped_deleted',
      projectId: draft.id,
    })
    return { id: draft.id, name: draft.name }
  }
  try {
    await enqueueProjectMutation(draft.id, async () => {
      if (!deletedProjectIds.has(draft.id)) await upsertCameraStageProjectRecord(draft.record)
    })
  } catch (error) {
    logger.error('[cameraStage] 保存工程失败', error, { projectId: draft.id })
    throw error
  }
  if (bindToCurrentProject && !deletedProjectIds.has(draft.id)) {
    useCameraStageStore.getState().bindProject(draft.id, draft.name)
    useCameraStageSessionStore.getState().setLastProjectId(draft.id)
  }
  return { id: draft.id, name: draft.name }
}

/** 保存当前场景为工程；新场景自动生成 id，返回保存后的工程标识 */
export async function saveCurrentProject(): Promise<SavedProjectInfo> {
  return await saveProjectDraft(createCurrentProjectDraft())
}

/** 把画布图片输入同步为工程环境贴图；路径只在工程内部持久化，不进入助手反射字段。 */
export async function applyProjectEnvironmentImage(
  projectId: string,
  environmentImageUrl: string | null,
): Promise<void> {
  logger.info('同步 3D 全景环境开始', {
    event: 'camera_stage.project.environment_sync.start',
    projectId,
    context: { enabled: Boolean(environmentImageUrl) },
  })
  try {
    const currentState = useCameraStageStore.getState()
    if (currentState.currentProjectId === projectId) {
      if (currentState.sceneSettings.sky.environmentImageUrl !== environmentImageUrl) {
        currentState.setSceneEnvironmentImageUrl(environmentImageUrl)
        await saveCurrentProject()
      }
    } else {
      const record = await getCameraStageProjectRecord(projectId)
      if (!record || !isCurrentCameraStageScene(record.sceneJson)) {
        logger.info('同步 3D 全景环境完成', {
          event: 'camera_stage.project.environment_sync.completed',
          projectId,
          context: { enabled: Boolean(environmentImageUrl), applied: false },
        })
        return
      }
      const snapshot = deserializeScene(record.sceneJson)
      if (snapshot.sceneSettings.sky.environmentImageUrl !== environmentImageUrl) {
        const sceneJson = serializeScene({
          objects: snapshot.objects,
          activeCameraId: snapshot.activeCameraId,
          sceneSettings: {
            ...snapshot.sceneSettings,
            sky: { ...snapshot.sceneSettings.sky, environmentImageUrl },
          },
          stateKeyframes: snapshot.stateKeyframes,
        })
        await enqueueProjectMutation(projectId, async () => {
          await upsertCameraStageProjectRecord({ ...record, sceneJson, updatedAt: Date.now() })
        })
      }
    }
    logger.info('同步 3D 全景环境完成', {
      event: 'camera_stage.project.environment_sync.completed',
      projectId,
      context: { enabled: Boolean(environmentImageUrl) },
    })
  } catch (error) {
    logger.error('同步 3D 全景环境失败', error, {
      event: 'camera_stage.project.environment_sync.failed',
      projectId,
      context: { enabled: Boolean(environmentImageUrl) },
    })
    throw error
  }
}

/** 新建空白工程：重置为空场景并立即保存入库，返回新工程标识 */
export async function createNewProject(
  name: string = CAMERA_STAGE_DEFAULT_PROJECT_NAME,
): Promise<SavedProjectInfo> {
  logger.info('新建运镜工程开始', { event: 'camera_stage.project.create.start' })
  useCameraStageStore.getState().newScene(name)
  useCameraStageSessionStore.getState().setLastProjectId(null)
  // 新工程默认摄像机视角；会话持久化的 stageViewMode 会在进入编辑器时回放，必须同步更新
  useCameraStageSessionStore.getState().setStageViewMode('camera')
  clearCameraStageHistory()
  try {
    const project = await saveCurrentProject()
    logger.info('新建运镜工程完成', {
      event: 'camera_stage.project.create.completed',
      projectId: project.id,
    })
    return project
  } catch (error) {
    logger.error('新建运镜工程失败', error, {
      event: 'camera_stage.project.create.failed',
    })
    throw error
  }
}

/** 为画布节点复制独立工程快照；复制后的后续编辑不再影响源工程。 */
export async function cloneCameraStageProject(projectId: string, name?: string): Promise<SavedProjectInfo | null> {
  const source = await getCameraStageProjectRecord(projectId)
  if (!source || !isCurrentCameraStageScene(source.sceneJson)) return null
  const snapshot = deserializeScene(source.sceneJson)
  const id = uuidv4()
  const now = Date.now()
  const nextName = name?.trim() || `${source.name} 副本`
  const sceneJson = serializeScene({
    objects: snapshot.objects,
    activeCameraId: snapshot.activeCameraId,
    sceneSettings: snapshot.sceneSettings,
    stateKeyframes: snapshot.stateKeyframes,
  })
  await upsertCameraStageProjectRecord({ ...source, id, name: nextName, sceneJson, createdAt: now, updatedAt: now })
  logger.info('画布工程快照已复制', { event: 'camera_stage.project.clone.completed', projectId: id, context: { sourceProjectId: projectId } })
  return { id, name: nextName }
}

/** 加载指定工程到场景，成功返回 true；工程不存在返回 false。后台渲染可关闭会话记录写入。 */
export async function loadProjectIntoScene(
  projectId: string,
  options: { updateSession?: boolean } = {},
): Promise<boolean> {
  const record = await getCameraStageProjectRecord(projectId)
  if (!record || !isCurrentCameraStageScene(record.sceneJson)) {
    return false
  }
  const snapshot = deserializeScene(record.sceneJson)
  useCameraStageStore.getState().loadSnapshot(
    {
      objects: snapshot.objects,
      activeCameraId: snapshot.activeCameraId,
      animation: snapshot.animation,
      sceneSettings: snapshot.sceneSettings,
      stateKeyframes: snapshot.stateKeyframes,
    },
    { id: record.id, name: record.name },
  )
  if (options.updateSession !== false) {
    const session = useCameraStageSessionStore.getState()
    if (session.lastProjectId !== record.id) session.setLastProjectId(record.id)
  }
  clearCameraStageHistory()
  return true
}

export async function listProjects(): Promise<CameraStageProjectPlatformSummary[]> {
  const summaries = await listCameraStageProjectSummaries()
  const checked = await Promise.all(summaries.map(async (summary) => {
    const record = await getCameraStageProjectRecord(summary.id)
    return record && isCurrentCameraStageScene(record.sceneJson) ? summary : null
  }))
  return checked.filter((summary): summary is CameraStageProjectPlatformSummary => summary !== null)
}

/** 读取持久化工程的完整领域快照；调用方不得解析 sceneJson 或复制兼容逻辑。 */
export async function readProjectSnapshot(projectId: string): Promise<CameraStageProjectSnapshot | null> {
  const record = await getCameraStageProjectRecord(projectId)
  if (!record || !isCurrentCameraStageScene(record.sceneJson)) return null
  const snapshot = deserializeScene(record.sceneJson)
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    objects: snapshot.objects,
    activeCameraId: snapshot.activeCameraId,
    animation: snapshot.animation,
    sceneSettings: snapshot.sceneSettings,
    stateKeyframes: snapshot.stateKeyframes,
  }
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
  deletedProjectIds.add(projectId)
  logger.info('删除运镜工程开始', { event: 'camera_stage.project.delete.start', projectId })
  try {
    await enqueueProjectMutation(projectId, async () => deleteCameraStageProjectRecord(projectId))
    logger.info('删除运镜工程完成', { event: 'camera_stage.project.delete.completed', projectId })
  } catch (error) {
    deletedProjectIds.delete(projectId)
    logger.error('删除运镜工程失败', error, { event: 'camera_stage.project.delete.failed', projectId })
    throw error
  }
  const session = useCameraStageSessionStore.getState()
  if (session.lastProjectId === projectId) {
    session.setLastProjectId(null)
  }
}
