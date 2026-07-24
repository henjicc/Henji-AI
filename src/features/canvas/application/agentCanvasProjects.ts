import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type ProjectSummary } from '@/stores/projectStore'

import { AgentCanvasActionError, openCanvasProjectFromAgent } from './agentCanvasActions'

const EMPTY_VIEWPORT = { x: 0, y: 0, zoom: 1 }

async function ensureProjectsHydrated(): Promise<void> {
  const projectStore = useProjectStore.getState()
  if (!projectStore.isHydrated) await projectStore.hydrate()
}

function requireProjectSummary(projectId: string): ProjectSummary {
  const project = useProjectStore.getState().projects.find((item) => item.id === projectId)
  if (!project) throw new AgentCanvasActionError('PROJECT_NOT_FOUND', '画布项目不存在', true, { projectId })
  return project
}

export async function listCanvasProjectsFromAgent(): Promise<ProjectSummary[]> {
  await ensureProjectsHydrated()
  return useProjectStore.getState().projects.map((project) => ({ ...project }))
}

export async function createCanvasProjectFromAgent(name: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  const normalized = name.trim()
  if (!normalized) throw new AgentCanvasActionError('INVALID_INPUT', '画布项目名称不能为空', true)
  const projectId = useProjectStore.getState().createProject(normalized)
  const project = useProjectStore.getState().currentProject
  useCanvasStore.getState().setCanvasData(project?.nodes ?? [], project?.edges ?? [], project?.history)
  useCanvasStore.getState().setViewportState(project?.viewport ?? EMPTY_VIEWPORT)
  return { projectId, name: normalized }
}

export async function closeCanvasProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  const store = useProjectStore.getState()
  if (store.currentProjectId !== projectId) {
    throw new AgentCanvasActionError('STALE_CONTEXT', '只能关闭当前打开的画布项目', true, {
      expectedProjectId: projectId,
      currentProjectId: store.currentProjectId,
    })
  }
  store.closeProject()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useCanvasStore.getState().setViewportState(EMPTY_VIEWPORT)
  return { projectId, status: 'closed' }
}

export async function renameCanvasProjectFromAgent(projectId: string, name: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  requireProjectSummary(projectId)
  const normalized = name.trim()
  if (!normalized) throw new AgentCanvasActionError('INVALID_INPUT', '画布项目名称不能为空', true)
  useProjectStore.getState().renameProject(projectId, normalized)
  return { projectId, name: normalized }
}

export async function deleteCanvasProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  await ensureProjectsHydrated()
  requireProjectSummary(projectId)
  const store = useProjectStore.getState()
  const wasCurrent = store.currentProjectId === projectId
  if (wasCurrent) {
    store.closeProject()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    useCanvasStore.getState().setViewportState(EMPTY_VIEWPORT)
  }
  useProjectStore.getState().deleteProject(projectId)
  return { projectId, status: 'deleted', wasCurrent }
}

export async function openCanvasProjectWithSummaryFromAgent(
  projectId: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const result = await openCanvasProjectFromAgent(projectId, signal)
  const project = useProjectStore.getState().currentProject
  return {
    ...result,
    name: project?.name ?? null,
    nodeCount: project?.nodeCount ?? 0,
  }
}
