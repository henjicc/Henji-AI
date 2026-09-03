export const DEVELOPMENT_LAUNCH_QUERY_KEYS = {
  skipOnboarding: 'henjiDevSkipOnboarding',
  surface: 'henjiDevSurface',
  media: 'henjiDevMedia',
} as const

export interface DevelopmentLaunchOptions {
  skipOnboarding: boolean
  surfaceId: string | null
  mediaPath: string | null
}
