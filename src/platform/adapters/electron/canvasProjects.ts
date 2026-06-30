import type {
  CanvasProjectPlatformRecord,
  CanvasProjectPlatformSnapshot,
  CanvasProjectsPlatform,
} from '@/platform/contracts/canvasProjects'

const DOMAIN = 'canvasProjects'

function getNativeCanvasProjects(): NonNullable<typeof window.henjiNative>['canvasProjects'] {
  const native = window.henjiNative
  if (!native?.canvasProjects) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.canvasProjects is not available`)
  }
  return native.canvasProjects
}

function normalizeRecord(record: NonNullable<typeof window.henjiNative>['canvasProjects'] extends { getProject(projectId: string): Promise<infer T> } ? NonNullable<T> : never): CanvasProjectPlatformRecord {
  return record as CanvasProjectPlatformRecord
}

export function createElectronCanvasProjects(): CanvasProjectsPlatform {
  return {
    listProjects: () => getNativeCanvasProjects().listProjects(),
    createProject: async (id: string, name: string, snapshot: CanvasProjectPlatformSnapshot) => {
      return normalizeRecord(await getNativeCanvasProjects().createProject(id, name, snapshot))
    },
    getProject: async (projectId: string) => {
      const record = await getNativeCanvasProjects().getProject(projectId)
      return record ? normalizeRecord(record) : null
    },
    renameProject: (projectId: string, name: string) => getNativeCanvasProjects().renameProject(projectId, name),
    saveProjectSnapshot: (projectId: string, snapshot: CanvasProjectPlatformSnapshot) =>
      getNativeCanvasProjects().saveProjectSnapshot(projectId, snapshot),
    deleteProject: (projectId: string) => getNativeCanvasProjects().deleteProject(projectId),
  }
}
