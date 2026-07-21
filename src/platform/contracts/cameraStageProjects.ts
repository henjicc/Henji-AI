export interface CameraStageProjectPlatformSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
}

export interface CameraStageProjectPlatformRecord extends CameraStageProjectPlatformSummary {
  sceneJson: string
}

export interface CameraStageProjectsPlatform {
  listProjectSummaries(): Promise<CameraStageProjectPlatformSummary[]>
  getProjectRecord(projectId: string): Promise<CameraStageProjectPlatformRecord | null>
  upsertProjectRecord(record: CameraStageProjectPlatformRecord): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}
