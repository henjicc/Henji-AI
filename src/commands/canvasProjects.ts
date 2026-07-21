import { getPlatform } from '@/platform'
import type {
  CanvasProjectPlatformRecord,
  CanvasProjectPlatformSnapshot,
  CanvasProjectPlatformSummary,
} from '@/platform/contracts/canvasProjects'

export async function listCanvasProjects(): Promise<CanvasProjectPlatformSummary[]> {
  return await getPlatform().canvasProjects.listProjects()
}

export async function createCanvasProject(
  id: string,
  name: string,
  snapshot: CanvasProjectPlatformSnapshot
): Promise<CanvasProjectPlatformRecord> {
  return await getPlatform().canvasProjects.createProject(id, name, snapshot)
}

export async function getCanvasProject(projectId: string): Promise<CanvasProjectPlatformRecord | null> {
  return await getPlatform().canvasProjects.getProject(projectId)
}

export async function renameCanvasProject(projectId: string, name: string): Promise<void> {
  await getPlatform().canvasProjects.renameProject(projectId, name)
}

export async function saveCanvasProjectSnapshot(
  projectId: string,
  snapshot: CanvasProjectPlatformSnapshot
): Promise<void> {
  await getPlatform().canvasProjects.saveProjectSnapshot(projectId, snapshot)
}

export async function deleteCanvasProject(projectId: string): Promise<void> {
  await getPlatform().canvasProjects.deleteProject(projectId)
}
