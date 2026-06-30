import {
  createCanvasProject,
  deleteCanvasProject,
  getCanvasProject,
  listCanvasProjects,
  renameCanvasProject,
  saveCanvasProjectSnapshot,
} from '@/commands/canvasProjects'
import type {
  CanvasProjectRecord,
  CanvasProjectSnapshot,
  CanvasProjectSummary,
} from './types'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

function nowProjectName(): string {
  const date = new Date()
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `项目 ${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function createProjectId(): string {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class CanvasProjectService {
  private static instance: CanvasProjectService | null = null

  static getInstance(): CanvasProjectService {
    if (!CanvasProjectService.instance) {
      CanvasProjectService.instance = new CanvasProjectService()
    }
    return CanvasProjectService.instance
  }

  async init(): Promise<void> {
    await Promise.resolve()
  }

  async listProjects(): Promise<CanvasProjectSummary[]> {
    return await listCanvasProjects()
  }

  async createProject(name?: string): Promise<CanvasProjectRecord> {
    const projectId = createProjectId()
    const snapshot: CanvasProjectSnapshot = {
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
    }
    return await createCanvasProject(projectId, name?.trim() || nowProjectName(), snapshot)
  }

  async getProject(projectId: string): Promise<CanvasProjectRecord | null> {
    return await getCanvasProject(projectId)
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    await renameCanvasProject(projectId, name.trim())
  }

  async saveProjectSnapshot(projectId: string, snapshot: CanvasProjectSnapshot): Promise<void> {
    await saveCanvasProjectSnapshot(projectId, {
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      viewport: snapshot.viewport ?? DEFAULT_VIEWPORT,
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    await deleteCanvasProject(projectId)
  }
}

export const canvasProjectService = CanvasProjectService.getInstance()
