export interface StoryboardProjectPlatformSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  coverPath: string | null
}

export interface StoryboardProjectPlatformRecord extends StoryboardProjectPlatformSummary {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

/** 写入侧不带封面：封面由 projectCovers 单独登记，工程自动保存不得把它覆盖成空。 */
export type StoryboardProjectPlatformWrite = Omit<StoryboardProjectPlatformRecord, 'coverPath'>

export interface StoryboardProjectsPlatform {
  listProjectSummaries(): Promise<StoryboardProjectPlatformSummary[]>
  getProjectRecord(projectId: string): Promise<StoryboardProjectPlatformRecord | null>
  upsertProjectRecord(record: StoryboardProjectPlatformWrite): Promise<void>
  updateProjectViewportRecord(projectId: string, viewportJson: string): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}
