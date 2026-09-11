import { getPlatform } from '@/platform'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'
import type {
  StoryboardProjectPlatformRecord,
  StoryboardProjectPlatformSummary,
  StoryboardProjectPlatformWrite,
} from '@/platform/contracts/storyboardProjects'

export async function listStoryboardProjectSummaries(): Promise<StoryboardProjectPlatformSummary[]> {
  return await getPlatform().storyboardProjects.listProjectSummaries()
}

export async function getStoryboardProjectRecord(projectId: string): Promise<StoryboardProjectPlatformRecord | null> {
  return await getPlatform().storyboardProjects.getProjectRecord(projectId)
}

export async function upsertStoryboardProjectRecord(record: StoryboardProjectPlatformWrite): Promise<void> {
  await getPlatform().storyboardProjects.upsertProjectRecord(record)
}

export async function updateStoryboardProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  await getPlatform().storyboardProjects.updateProjectViewportRecord(projectId, viewportJson)
}

export async function renameStoryboardProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number,
  operationCorrelation?: ApplicationPersistenceCorrelation,
): Promise<void> {
  await getPlatform().storyboardProjects.renameProjectRecord(projectId, name, updatedAt, operationCorrelation)
}

export async function deleteStoryboardProjectRecord(projectId: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> {
  await getPlatform().storyboardProjects.deleteProjectRecord(projectId, operationCorrelation)
}
