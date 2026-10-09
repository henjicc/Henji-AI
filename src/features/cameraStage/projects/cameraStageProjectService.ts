import { createLogger } from '@/core/logging'
import type { DocumentContainerRef } from '@/core/documents/types'
import { isDocumentServiceError } from '@/features/documents/documentErrors'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import { cameraStageStoreAttachment, useCameraStageStore } from '../store/cameraStageStore'
import {
  attachCameraStageProject,
  bindCameraStageSession,
  cameraStageDocumentRegistry,
  cameraStageProjectStore,
  createCameraStageDraftRuntime,
  leaseCameraStageProjectRuntime,
  leaveCameraStageProject,
  saveCameraStageProjectRuntime,
} from '../application/cameraStageProjectRuntime'

/*
 * 镜头参考文档的界面入口（3.2）：新建草稿、打开、离开（返回列表或切换文档）、画布节点内嵌的文档。
 * 列表、改名、移动、副本、回收站都是通用文档操作（src/features/documents），这里不再有。
 */

const logger = createLogger('features.cameraStage.documents')

export interface SavedProjectInfo { id: string; name: string }

/** 用户取消了“保存 / 不保存 / 取消”里的取消：留在当前文档，不切换。 */
export class CameraStageLeaveCancelledError extends Error {
  constructor() {
    super('已取消，仍停留在当前镜头参考。')
    this.name = 'CameraStageLeaveCancelledError'
  }
}

function editorDocumentId(): string | null {
  const state = cameraStageStoreAttachment.getStore().getState()
  return state.currentProjectId
}

/**
 * 界面上正在显示的另一份文档先走离开流程（草稿会询问保存）；取消时抛 CameraStageLeaveCancelledError。
 * 切到同一份文档不离开。
 */
async function leaveEditorDocumentBefore(nextId: string | null): Promise<void> {
  const current = editorDocumentId()
  if (!current || current === nextId) return
  const outcome = await leaveCameraStageProject(current)
  if (outcome === 'cancelled') throw new CameraStageLeaveCancelledError()
}

function showInEditor(projectId: string): void {
  const session = useCameraStageSessionStore.getState()
  session.setLastDocumentId(projectId)
  session.setAppView('editor')
}

/**
 * 页面“新建镜头参考”：以草稿新建在“镜头参考”文件夹并进入编辑器（离开时再起名）。
 * 在剪辑里新建（4.1）时给出所在项目，草稿建在项目里。
 */
export async function createDraftCameraStageDocument(container: DocumentContainerRef = { kind: 'user' }): Promise<SavedProjectInfo> {
  await leaveEditorDocumentBefore(null)
  const instance = await createCameraStageDraftRuntime(container)
  await attachCameraStageProject(instance.id)
  cameraStageProjectStore(instance.id).getState().setViewMode('camera')
  useCameraStageSessionStore.getState().setStageViewMode('camera')
  showInEditor(instance.id)
  logger.info('新建镜头参考草稿', { event: 'camera_stage.document.create_draft.completed', context: { docId: instance.id } })
  return { id: instance.id, name: instance.session.documentMeta.name }
}

/**
 * 打开文档进入编辑器（列表卡片、草稿区“继续编辑”、通用 open_document、工具首页最近文件、助手聚焦共用）。
 * 界面正在编辑另一份时先离开它。
 */
export async function openCameraStageDocument(document: { id: string; path?: string }): Promise<void> {
  await leaveEditorDocumentBefore(document.id)
  await attachCameraStageProject(document.id, document.path)
  showInEditor(document.id)
}

/** 编辑器“返回”：离开当前文档后回到列表；取消时留在编辑器。 */
export async function leaveCameraStageEditor(): Promise<DocumentLeaveOutcome> {
  const current = editorDocumentId()
  const outcome = current ? await leaveCameraStageProject(current) : 'closed'
  if (outcome === 'cancelled') return outcome
  const session = useCameraStageSessionStore.getState()
  session.setLastDocumentId(null)
  session.setAppView('list')
  return outcome
}

/** 启动恢复（应用重启后回到上次编辑的文档）：只附着，不改会话记录。找不到时返回 false。 */
export async function loadProjectIntoScene(projectId: string, options: { updateSession?: boolean } = {}): Promise<boolean> {
  try { await attachCameraStageProject(projectId) }
  catch (error) { if (error instanceof Error && error.message === 'NOT_FOUND') return false; throw error }
  if (options.updateSession !== false) useCameraStageSessionStore.getState().setLastDocumentId(projectId)
  return true
}

/**
 * 画布节点内嵌的镜头参考：直接新建已命名（非草稿）的文档并打开实例，不切换当前界面。
 * 名称沿用节点名；同一文件夹已有同名时改用自动名（未命名镜头参考 N）。
 * 建在画布所在的容器里（3.4：项目里的画布 → 同一个项目；独立画布 → 作品目录“镜头参考”）。
 */
export async function createNamedCameraStageDocument(name: string, container: DocumentContainerRef = { kind: 'user' }): Promise<SavedProjectInfo> {
  const registry = cameraStageDocumentRegistry()
  const trimmed = name.trim()
  let session
  try {
    session = await registry.create({ kind: 'camera_stage', container, ...(trimmed ? { name: trimmed } : {}), draft: false })
  } catch (error) {
    if (!isDocumentServiceError(error, 'DocumentNameConflictError') && !isDocumentServiceError(error, 'DocumentNameInvalidError')) throw error
    session = await registry.create({ kind: 'camera_stage', container, draft: false })
  }
  const instance = bindCameraStageSession(session)
  logger.info('新建镜头参考文档', { event: 'camera_stage.document.create_named.completed', context: { docId: instance.id } })
  return { id: instance.id, name: session.documentMeta.name }
}

/** 画布节点内嵌并进入编辑器（节点对话框）：新建后附着到界面。 */
export async function createNamedCameraStageDocumentInEditor(name: string, container: DocumentContainerRef = { kind: 'user' }): Promise<SavedProjectInfo> {
  const created = await createNamedCameraStageDocument(name, container)
  await attachCameraStageProject(created.id)
  cameraStageProjectStore(created.id).getState().setViewMode('camera')
  useCameraStageSessionStore.getState().setLastDocumentId(created.id)
  useCameraStageSessionStore.getState().setStageViewMode('camera')
  return created
}

/** 画布复制节点时复制它的镜头参考：通用“创建副本”（同一文件夹，自动加序号）。 */
export async function duplicateCameraStageDocument(projectId: string): Promise<SavedProjectInfo | null> {
  try {
    const result = await getDocumentOperations().duplicateDocument({ id: projectId }, 'keepBoth')
    return { id: result.meta.id, name: result.meta.name }
  } catch (error) {
    if (isDocumentServiceError(error, 'DocumentNotFoundError')) return null
    throw error
  }
}

/** 仅撤回尚未交给画布的副本；复用文档删除屏障和系统回收站，不删除原件。 */
export async function rollbackDuplicatedCameraStageDocument(projectId: string): Promise<void> {
  await getDocumentOperations().trashDocument({ id: projectId })
}

/** 同步画布输入到目标文档实例，保留尚未落盘的其他编辑。 */
export async function applyProjectEnvironmentImage(projectId: string, environmentImageUrl: string | null): Promise<void> {
  const release = await leaseCameraStageProjectRuntime(projectId)
  try {
    const state = cameraStageProjectStore(projectId).getState()
    if (state.sceneSettings.sky.environmentImageUrl !== environmentImageUrl) state.setSceneEnvironmentImageUrl(environmentImageUrl)
    await saveCameraStageProjectRuntime(projectId)
  } catch (error) {
    logger.error('同步 3D 全景环境失败', error, { event: 'camera_stage.document.environment_sync.failed', context: { docId: projectId } })
    throw error
  } finally { release() }
}

/** 当前界面显示的文档 ID（没有时为 null）。 */
export function currentCameraStageDocumentId(): string | null {
  return useCameraStageStore.getState().currentProjectId
}
