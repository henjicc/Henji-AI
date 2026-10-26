import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  DEVELOPMENT_LAUNCH_QUERY_KEYS,
  DEVELOPMENT_LAUNCH_SURFACE_PATTERN,
  isDevelopmentLayoutGuardMode,
  isDevelopmentUpdatePreviewState,
} from '../../src/core/development/developmentLaunchContract'
import { THEME_PRESET_IDS } from '../../src/core/theme/themeEngine'

export interface DevelopmentLaunchQuery {
  query: Record<string, string>
  warnings: string[]
}

function readOption(argv: readonly string[], name: string): string | null {
  const prefix = `${name}=`
  const argument = argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length).trim() || null : null
}

function isValidSurfaceId(value: string): boolean {
  return DEVELOPMENT_LAUNCH_SURFACE_PATTERN.test(value)
}

export function resolveDevelopmentLaunchQuery(
  argv: readonly string[] = process.argv,
  workingDirectory = process.cwd()
): DevelopmentLaunchQuery {
  const query: Record<string, string> = {}
  const warnings: string[] = []

  if (argv.includes('--dev-skip-onboarding')) {
    query[DEVELOPMENT_LAUNCH_QUERY_KEYS.skipOnboarding] = '1'
  }

  const surfaceId = readOption(argv, '--dev-surface')
  if (surfaceId) {
    if (isValidSurfaceId(surfaceId)) {
      query[DEVELOPMENT_LAUNCH_QUERY_KEYS.surface] = surfaceId
    } else {
      warnings.push('开发启动 Surface ID 无效，已忽略自动定位。')
    }
  }

  // 本次启动临时使用的主题预设（不写入用户设置），供真实界面巡检按预设截图
  const themePreset = readOption(argv, '--dev-theme-preset')
  if (themePreset) {
    if ((THEME_PRESET_IDS as readonly string[]).includes(themePreset)) {
      query[DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset] = themePreset
    } else {
      warnings.push('开发启动主题预设无效，已忽略。')
    }
  }

  // 更新提示弹窗预览（界面核对用）：只在主窗口打开弹窗，不访问更新服务器
  const updatePreview = readOption(argv, '--dev-update-preview')
  if (updatePreview) {
    if (isDevelopmentUpdatePreviewState(updatePreview)) {
      query[DEVELOPMENT_LAUNCH_QUERY_KEYS.updatePreview] = updatePreview
    } else {
      warnings.push('开发启动更新预览状态无效，已忽略。')
    }
  }

  // 开发检查：严格模式、布局守卫、主动作预算与 debug 日志一起打开；默认关，开发运行与正式版一致
  if (argv.includes('--dev-checks')) query[DEVELOPMENT_LAUNCH_QUERY_KEYS.checks] = '1'

  // 运行时布局守卫：`--dev-layout-guard` 描边 + 日志，`--dev-layout-guard=log` 只记日志
  const layoutGuard = argv.includes('--dev-layout-guard') ? 'outline' : readOption(argv, '--dev-layout-guard')
  if (layoutGuard) {
    if (isDevelopmentLayoutGuardMode(layoutGuard)) query[DEVELOPMENT_LAUNCH_QUERY_KEYS.layoutGuard] = layoutGuard
    else warnings.push('开发启动布局守卫模式无效，已忽略。')
  }

  const mediaArgument = readOption(argv, '--dev-media')
  if (mediaArgument) {
    const mediaPath = path.resolve(workingDirectory, mediaArgument)
    try {
      if (existsSync(mediaPath) && statSync(mediaPath).isFile()) {
        query[DEVELOPMENT_LAUNCH_QUERY_KEYS.media] = mediaPath
      } else {
        warnings.push('开发启动素材不存在或不是文件，已忽略自动加载。')
      }
    } catch {
      warnings.push('开发启动素材无法访问，已忽略自动加载。')
    }
  }

  return { query, warnings }
}

/**
 * 附属窗口（日志窗口）沿用的开发启动参数：只带对所有窗口都成立的主题预设、开发检查与布局守卫，
 * 页面定位、素材与首次引导只属于主窗口。日志窗口与主窗口同源应用主题（重要记录 010），
 * 巡检用 `--dev-theme-preset` 截图时两个窗口必须是同一个预设。
 */
export function resolveSecondaryWindowLaunchQuery(
  argv: readonly string[] = process.argv,
  workingDirectory = process.cwd()
): Record<string, string> {
  const { query } = resolveDevelopmentLaunchQuery(argv, workingDirectory)
  const themePreset = query[DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset]
  // 布局守卫对所有窗口都成立（日志窗口一样可能被裁切或遮挡）
  const layoutGuard = query[DEVELOPMENT_LAUNCH_QUERY_KEYS.layoutGuard]
  const checks = query[DEVELOPMENT_LAUNCH_QUERY_KEYS.checks]
  return { ...(themePreset ? { [DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset]: themePreset } : {}), ...(checks ? { [DEVELOPMENT_LAUNCH_QUERY_KEYS.checks]: checks } : {}), ...(layoutGuard ? { [DEVELOPMENT_LAUNCH_QUERY_KEYS.layoutGuard]: layoutGuard } : {}) }
}
