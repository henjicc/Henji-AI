import {
  DEVELOPMENT_LAUNCH_QUERY_KEYS,
  isDevelopmentLayoutGuardMode,
  isDevelopmentUpdatePreviewState,
  type DevelopmentLaunchOptions,
} from './developmentLaunchContract'

export function readDevelopmentLaunchOptions(
  search = typeof window === 'undefined' ? '' : window.location.search
): DevelopmentLaunchOptions {
  const params = new URLSearchParams(search)
  const updatePreview = params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.updatePreview)
  const layoutGuard = params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.layoutGuard)
  return {
    skipOnboarding: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.skipOnboarding) === '1',
    surfaceId: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.surface) || null,
    mediaPath: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.media) || null,
    themePresetId: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset) || null,
    updatePreview: isDevelopmentUpdatePreviewState(updatePreview) ? updatePreview : null,
    layoutGuard: isDevelopmentLayoutGuardMode(layoutGuard) ? layoutGuard : null,
    checks: params.get(DEVELOPMENT_LAUNCH_QUERY_KEYS.checks) === '1',
  }
}

/** 界面开发检查（布局守卫、主动作预算）是否开启：`--dev-checks` 或单独的 `--dev-layout-guard`。 */
export function isDevelopmentUiCheckEnabled(options = readDevelopmentLaunchOptions()): boolean {
  return options.checks || options.layoutGuard !== null
}
