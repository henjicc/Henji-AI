import { getPlatform } from '@/platform'
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
): Promise<void> {
  await getPlatform().cameraStageProjects.renameProjectRecord(projectId, name, updatedAt)
}

export async function deleteCameraStageProjectRecord(projectId: string): Promise<void> {
  await getPlatform().cameraStageProjects.deleteProjectRecord(projectId)
}
