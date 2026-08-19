import { getPlatform } from '@/platform'
import type {
  ProjectCoverPlatformRequest,
  ProjectCoverPlatformResult,
} from '@/platform/contracts/projectCovers'

export async function saveProjectCover(
  request: ProjectCoverPlatformRequest,
): Promise<ProjectCoverPlatformResult> {
  return await getPlatform().projectCovers.saveCover(request)
}
