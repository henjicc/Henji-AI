import { getPlatform } from '@/platform'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'
import type {
  CameraStageProjectPlatformRecord,
  CameraStageProjectPlatformSummary,
  CameraStageProjectPlatformWrite,
} from '@/platform/contracts/cameraStageProjects'

export async function listCameraStageProjectSummaries(): Promise<CameraStageProjectPlatformSummary[]> {
  return await getPlatform().cameraStageProjects.listProjectSummaries()
}

export async function getCameraStageProjectRecord(
  projectId: string,
): Promise<CameraStageProjectPlatformRecord | null> {
  return await getPlatform().cameraStageProjects.getProjectRecord(projectId)
}

export async function upsertCameraStageProjectRecord(
  record: CameraStageProjectPlatformWrite,
): Promise<void> {
  await getPlatform().cameraStageProjects.upsertProjectRecord(record)
}

export async function renameCameraStageProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number,
  operationCorrelation?: ApplicationPersistenceCorrelation,
): Promise<void> {
  await getPlatform().cameraStageProjects.renameProjectRecord(projectId, name, updatedAt, operationCorrelation)
}

export async function deleteCameraStageProjectRecord(projectId: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> {
  await getPlatform().cameraStageProjects.deleteProjectRecord(projectId, operationCorrelation)
}
