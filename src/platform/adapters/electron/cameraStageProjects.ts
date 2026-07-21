import type {
  CameraStageProjectPlatformRecord,
  CameraStageProjectsPlatform,
} from '@/platform/contracts/cameraStageProjects'

const DOMAIN = 'cameraStageProjects'

function getNativeCameraStageProjects(): NonNullable<typeof window.henjiNative>['cameraStageProjects'] {
  const native = window.henjiNative
  if (!native?.cameraStageProjects) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.cameraStageProjects is not available`)
  }
  return native.cameraStageProjects
}

export function createElectronCameraStageProjects(): CameraStageProjectsPlatform {
  return {
    listProjectSummaries: () => getNativeCameraStageProjects().listProjectSummaries(),
    getProjectRecord: async (projectId: string) => {
      const record = await getNativeCameraStageProjects().getProjectRecord(projectId)
      return record ?? null
    },
    upsertProjectRecord: (record: CameraStageProjectPlatformRecord) =>
      getNativeCameraStageProjects().upsertProjectRecord(record),
    renameProjectRecord: (projectId: string, name: string, updatedAt: number) =>
      getNativeCameraStageProjects().renameProjectRecord(projectId, name, updatedAt),
    deleteProjectRecord: (projectId: string) => getNativeCameraStageProjects().deleteProjectRecord(projectId),
  }
}
