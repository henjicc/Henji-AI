import {
  DEVELOPMENT_LAUNCH_QUERY_KEYS,
  type DevelopmentLaunchOptions,
} from './developmentLaunchContract'

export function readDevelopmentLaunchOptions(
  search = typeof window === 'undefined' ? '' : window.location.search
): DevelopmentLaunchOptions {
  const params = new URLSearchParams(search)
  return {
    skipOnboarding: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.skipOnboarding) === '1',
    surfaceId: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.surface) || null,
    mediaPath: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.media) || null,
  }
}
