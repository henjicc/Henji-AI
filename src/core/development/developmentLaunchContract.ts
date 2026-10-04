export const DEVELOPMENT_LAUNCH_QUERY_KEYS = {
  skipOnboarding: 'henjiDevSkipOnboarding',
  surface: 'henjiDevSurface',
  media: 'henjiDevMedia',
  themePreset: 'henjiDevThemePreset',
  updatePreview: 'henjiDevUpdatePreview',
} as const

/**
 * 更新提示弹窗的开发预览状态（任务 5.7）：没有真实新版本也能打开弹窗核对界面。
 * 只给开发启动与界面核对用，不访问更新服务器、不下载、不安装。
 */
export const DEVELOPMENT_UPDATE_PREVIEW_STATES = ['available', 'downloading', 'failed'] as const
export type DevelopmentUpdatePreviewState = (typeof DEVELOPMENT_UPDATE_PREVIEW_STATES)[number]

export function isDevelopmentUpdatePreviewState(value: unknown): value is DevelopmentUpdatePreviewState {
  return typeof value === 'string' && (DEVELOPMENT_UPDATE_PREVIEW_STATES as readonly string[]).includes(value)
}

export interface DevelopmentLaunchOptions {
  skipOnboarding: boolean
  surfaceId: string | null
  mediaPath: string | null
  /** 本次启动临时使用的主题预设（不写入设置），供真实界面巡检按预设截图 */
  themePresetId: string | null
  /** 本次启动直接打开更新提示弹窗的预览状态（不访问更新服务器） */
  updatePreview: DevelopmentUpdatePreviewState | null
}
