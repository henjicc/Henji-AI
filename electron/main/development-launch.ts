import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { DEVELOPMENT_LAUNCH_QUERY_KEYS } from '../../src/core/development/developmentLaunchContract'

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
