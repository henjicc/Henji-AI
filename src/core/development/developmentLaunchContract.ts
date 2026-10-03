export const DEVELOPMENT_LAUNCH_QUERY_KEYS = {
  skipOnboarding: 'henjiDevSkipOnboarding',
  surface: 'henjiDevSurface',
  media: 'henjiDevMedia',
  themePreset: 'henjiDevThemePreset',
} as const

export interface DevelopmentLaunchOptions {
  skipOnboarding: boolean
  surfaceId: string | null
  mediaPath: string | null
  /** 本次启动临时使用的主题预设（不写入设置），供真实界面巡检按预设截图 */
  themePresetId: string | null
}
