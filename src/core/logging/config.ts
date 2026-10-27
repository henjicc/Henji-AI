import type { LogConfig, LogLevel } from './types'
import { readDevelopmentLaunchOptions } from '@/core/development/developmentLaunch'

const TEST_MODE_STORAGE_KEY = 'henji_test_mode'

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

let logConfig: LogConfig = {
  level: resolveDefaultLevel(),
  enabledDomains: null,
  persistToFile: true,
  bufferSize: 400,
  flushIntervalMs: 450,
  flushBatchSize: 60,
}

function resolveDefaultLevel(): LogLevel {
  // 开发运行与正式版同一默认级别；debug 日志用测试模式或 `--dev-checks` 打开。单元测试照旧记 debug（不少测试断言 debug 事件）。
  // 按 Vitest 本身判断而不是 MODE：测试按套件用 `--mode unit` / `native` 等运行，MODE 并不是 'test'。
  if (import.meta.env.VITEST || (import.meta.env.DEV && readDevelopmentLaunchOptions().checks)) {
    return 'debug'
  }
  return isTestModeEnabledFromStorage() ? 'debug' : 'info'
}

function isTestModeEnabledFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(TEST_MODE_STORAGE_KEY)
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as { enabled?: boolean } | null
    return parsed?.enabled === true
  } catch {
    return false
  }
}

export function getLogConfig(): LogConfig {
  return logConfig
}

export function setLogConfig(partial: Partial<LogConfig>): LogConfig {
  logConfig = {
    ...logConfig,
    ...partial,
  }
  return logConfig
}

export function refreshLogConfigByRuntime(): LogConfig {
  return setLogConfig({
    level: resolveDefaultLevel(),
  })
}

export function shouldLogLevel(level: LogLevel): boolean {
  const current = LOG_LEVEL_PRIORITY[logConfig.level]
  return LOG_LEVEL_PRIORITY[level] >= current
}

export function isDomainEnabled(domain: string): boolean {
  if (!logConfig.enabledDomains || logConfig.enabledDomains.length === 0) {
    return true
  }

  return logConfig.enabledDomains.some((allowed) => {
    return domain === allowed || domain.startsWith(`${allowed}.`)
  })
}
