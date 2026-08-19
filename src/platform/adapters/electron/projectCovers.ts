import type {
  ProjectCoverPlatformRequest,
  ProjectCoversPlatform,
} from '@/platform/contracts/projectCovers'

const DOMAIN = 'projectCovers'

function getNativeProjectCovers(): NonNullable<typeof window.henjiNative>['projectCovers'] {
  const native = window.henjiNative
  if (!native?.projectCovers) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.projectCovers is not available`)
  }
  return native.projectCovers
}

export function createElectronProjectCovers(): ProjectCoversPlatform {
  return {
    saveCover: (request: ProjectCoverPlatformRequest) => getNativeProjectCovers().saveCover(request),
  }
}
