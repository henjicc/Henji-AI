import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type ProjectSummary } from '@/stores/projectStore'

import { CanvasApplicationError, openCanvasProject } from './canvasApplicationService'
import { updateCanvasProjectCover } from './canvasProjectCover'
import { getProjectRecord } from '@/commands/projectState'

const EMPTY_VIEWPORT = { x: 0, y: 0, zoom: 1 }

async function ensureProjectsHydrated(): Promise<void> {
  const projectStore = useProjectStore.getState()
  if (!projectStore.isHydrated) await projectStore.hydrate()
}

function requireProjectSummary(projectId: string): ProjectSummary {
  const project = useProjectStore.getState().projects.find((item) => item.id === projectId)
  if (!project) throw new CanvasApplicationError('PROJECT_NOT_FOUND', '画布项目不存在', true, { projectId })
  return project
}

export async function listCanvasProjects(): Promise<ProjectSummary[]> {
  await ensureProjectsHydrated()
  return useProjectStore.getState().projects.map((project) => ({ ...project }))
}

export async function createCanvasProject(name: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  const normalized = name.trim()
  if (!normalized) throw new CanvasApplicationError('INVALID_INPUT', '画布项目名称不能为空', true)
  const projectId = await useProjectStore.getState().createProject(normalized, { attach: false })
  const saved = await getProjectRecord(projectId)
  return { projectId, name: normalized, verification: {
    verified: saved?.id === projectId && saved.name === normalized,
    condition: '新建画布项目已从持久存储回读确认',
    target: { kind: 'canvas.project', id: projectId },
  } }
}

export async function closeCanvasProject(projectId: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  const store = useProjectStore.getState()
  if (store.currentProjectId !== projectId) {
    throw new CanvasApplicationError('STALE_CONTEXT', '只能关闭当前打开的画布项目', true, {
      expectedProjectId: projectId,
      currentProjectId: store.currentProjectId,
    })
  }
  await updateCanvasProjectCover(projectId)
  await store.closeProject()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useCanvasStore.getState().setViewportState(EMPTY_VIEWPORT)
  return { projectId, status: 'closed' }
}

export async function renameCanvasProject(projectId: string, name: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  requireProjectSummary(projectId)
  const normalized = name.trim()
  if (!normalized) throw new CanvasApplicationError('INVALID_INPUT', '画布项目名称不能为空', true)
  await useProjectStore.getState().renameProject(projectId, normalized)
  return { projectId, name: normalized }
}

export async function deleteCanvasProject(projectId: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  requireProjectSummary(projectId)
  const store = useProjectStore.getState()
  const wasCurrent = store.currentProjectId === projectId
  if (wasCurrent) {
    await store.closeProject()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    useCanvasStore.getState().setViewportState(EMPTY_VIEWPORT)
  }
  await useProjectStore.getState().deleteProject(projectId)
  /*
   * 回执必须带 verification：外部操作账本的 `ok` 只认 `data.verification.verified`，
   * 缺了它，一次**真的删掉了**的删除会以 `ok:false` / `isError:true` 交给调用方。
   * 删除是 R3 破坏性操作——把成功报成失败，客户端按常理会重试，而重试一个已经
   * 完成的删除正是最不该发生的事。这里按正式存储读回来确认工程确实不在了再声明。
   */
  const remaining = await getProjectRecord(projectId)
  return { projectId, status: 'deleted', wasCurrent, verification: {
    verified: !remaining,
    condition: '已按正式存储读回确认该画布工程不存在',
    target: { kind: 'canvas.project', id: projectId },
  } }
}

export async function openCanvasProjectWithSummary(
  projectId: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const result = await openCanvasProject(projectId, signal)
  const project = useProjectStore.getState().currentProject
  return {
    ...result,
    name: project?.name ?? null,
    nodeCount: project?.nodeCount ?? 0,
  }
}
