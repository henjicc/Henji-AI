export interface CameraStageProjectPlatformSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
  coverPath: string | null
}

export interface CameraStageProjectPlatformRecord extends CameraStageProjectPlatformSummary {
  sceneJson: string
}

/** 写入侧不带封面：封面由 projectCovers 单独登记，场景自动保存不得把它覆盖成空。 */
export type CameraStageProjectPlatformWrite = Omit<CameraStageProjectPlatformRecord, 'coverPath'>

export interface CameraStageProjectsPlatform {
  listProjectSummaries(): Promise<CameraStageProjectPlatformSummary[]>
  getProjectRecord(projectId: string): Promise<CameraStageProjectPlatformRecord | null>
  upsertProjectRecord(record: CameraStageProjectPlatformWrite): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}
