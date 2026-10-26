export const DEVELOPMENT_LAUNCH_QUERY_KEYS = {
  skipOnboarding: 'henjiDevSkipOnboarding',
  surface: 'henjiDevSurface',
  media: 'henjiDevMedia',
  themePreset: 'henjiDevThemePreset',
  updatePreview: 'henjiDevUpdatePreview',
  layoutGuard: 'henjiDevLayoutGuard',
  checks: 'henjiDevChecks',
} as const

/**
 * 开发检查 `--dev-checks`：React 严格模式（组件挂载两次、副作用跑两遍）、布局守卫描边、主动作预算检查、debug 日志与翻译调试输出一起打开。
 * 默认不开，开发运行的行为与性能贴近正式版，日常改动与用户查看都用热更新开发版（2026-10-26 用户确认）；查组件副作用或界面层级问题时显式打开。
 */

/**
 * 运行时布局守卫（重要记录 020）：`--dev-layout-guard`（描边 + 日志）或 `--dev-layout-guard=log`（只记日志）。
 * 默认不运行（开发运行与正式版一致，2026-10-26 起）；`--dev-checks` 时描边；安装包不运行。
 */
export const DEVELOPMENT_LAYOUT_GUARD_MODES = ['outline', 'log'] as const
export type DevelopmentLayoutGuardMode = (typeof DEVELOPMENT_LAYOUT_GUARD_MODES)[number]
export function isDevelopmentLayoutGuardMode(value: unknown): value is DevelopmentLayoutGuardMode {
  return typeof value === 'string' && (DEVELOPMENT_LAYOUT_GUARD_MODES as readonly string[]).includes(value)
}

/**
 * 只供开发与界面核对的页面（任务 5.11）：经 `--dev-surface=dev.*` 进入，不登记为应用 Surface，
 * 正式界面、助手与 MCP 都看不到。组件样张页：`@/components/ui` 全部共享组件与关键状态一页铺开。
 */
export const DEVELOPMENT_SURFACE_IDS = {
  uiGallery: 'dev.ui_gallery',
} as const

/** 分区在既有 dev.ui_gallery 页内选择；不新增应用 Surface 或助手入口。 */
export const DEVELOPMENT_GALLERY_QUERY_KEYS = { section: 'henjiGallerySection' } as const

export type DevelopmentSurfaceId = (typeof DEVELOPMENT_SURFACE_IDS)[keyof typeof DEVELOPMENT_SURFACE_IDS]

export function isDevelopmentSurfaceId(value: unknown): value is DevelopmentSurfaceId {
  return typeof value === 'string' && (Object.values(DEVELOPMENT_SURFACE_IDS) as string[]).includes(value)
}

/** `--dev-surface` 接受的格式：应用 Surface（workspace/tool/settings/overlay）或开发页面（dev）。 */
export const DEVELOPMENT_LAUNCH_SURFACE_PATTERN = /^(workspace|tool|settings|overlay|dev)\.[a-z0-9_.-]+$/

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
  /** 本次启动的运行时布局守卫模式；null 时只在开了开发检查时描边 */
  layoutGuard: DevelopmentLayoutGuardMode | null
  /** 本次启动是否打开开发检查（严格模式、布局守卫、主动作预算、debug 日志） */
  checks: boolean
}
