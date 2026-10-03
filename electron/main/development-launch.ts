import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { DEVELOPMENT_LAUNCH_QUERY_KEYS } from '../../src/core/development/developmentLaunchContract'
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
  return /^(workspace|tool|settings|overlay)\.[a-z0-9_.-]+$/.test(value)
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
 * 附属窗口（日志窗口）沿用的开发启动参数：只带对所有窗口都成立的主题预设，
 * 页面定位、素材与首次引导只属于主窗口。日志窗口与主窗口同源应用主题（重要记录 010），
 * 巡检用 `--dev-theme-preset` 截图时两个窗口必须是同一个预设。
 */
export function resolveSecondaryWindowLaunchQuery(
  argv: readonly string[] = process.argv,
  workingDirectory = process.cwd()
): Record<string, string> {
  const themePreset = resolveDevelopmentLaunchQuery(argv, workingDirectory)
    .query[DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset]
  return themePreset ? { [DEVELOPMENT_LAUNCH_QUERY_KEYS.themePreset]: themePreset } : {}
}
