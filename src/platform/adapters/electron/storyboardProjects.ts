import type {
  StoryboardProjectPlatformRecord,
  StoryboardProjectsPlatform,
} from '@/platform/contracts/storyboardProjects'

const DOMAIN = 'storyboardProjects'

function getNativeStoryboardProjects(): NonNullable<typeof window.henjiNative>['storyboardProjects'] {
  const native = window.henjiNative
  if (!native?.storyboardProjects) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.storyboardProjects is not available`)
  }
  return native.storyboardProjects
}

function normalizeRecord(record: NonNullable<Awaited<ReturnType<NonNullable<typeof window.henjiNative>['storyboardProjects']['getProjectRecord']>>>): StoryboardProjectPlatformRecord {
  return record
}

export function createElectronStoryboardProjects(): StoryboardProjectsPlatform {
  return {
    listProjectSummaries: () => getNativeStoryboardProjects().listProjectSummaries(),
    getProjectRecord: async (projectId: string) => {
      const record = await getNativeStoryboardProjects().getProjectRecord(projectId)
      return record ? normalizeRecord(record) : null
    },
    upsertProjectRecord: (record: StoryboardProjectPlatformRecord) => getNativeStoryboardProjects().upsertProjectRecord(record),
    updateProjectViewportRecord: (projectId: string, viewportJson: string) =>
      getNativeStoryboardProjects().updateProjectViewportRecord(projectId, viewportJson),
    renameProjectRecord: (projectId: string, name: string, updatedAt: number) =>
      getNativeStoryboardProjects().renameProjectRecord(projectId, name, updatedAt),
    deleteProjectRecord: (projectId: string) => getNativeStoryboardProjects().deleteProjectRecord(projectId),
  }
}
