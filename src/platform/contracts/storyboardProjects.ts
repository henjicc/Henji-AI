export interface StoryboardProjectPlatformSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
}

export interface StoryboardProjectPlatformRecord extends StoryboardProjectPlatformSummary {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

export interface StoryboardProjectsPlatform {
  listProjectSummaries(): Promise<StoryboardProjectPlatformSummary[]>
  getProjectRecord(projectId: string): Promise<StoryboardProjectPlatformRecord | null>
  upsertProjectRecord(record: StoryboardProjectPlatformRecord): Promise<void>
  updateProjectViewportRecord(projectId: string, viewportJson: string): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}
