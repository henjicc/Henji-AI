import fs from 'node:fs/promises'
import path from 'node:path'
import { getLogDir } from './writer'
import { MAIN_LOG_FILE_PREFIX, MAIN_LOG_MAX_TOTAL_BYTES, MAIN_LOG_RETENTION_DAYS } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

interface LogFileStat {
  filePath: string
  mtimeMs: number
  size: number
}

async function listLogFiles(logDir: string): Promise<LogFileStat[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(logDir)
  } catch {
    return []
  }

  const stats: LogFileStat[] = []
  for (const entry of entries) {
    // 只清理新命名规则的日志文件；旧的 frontend-*.log 不带 MAIN_LOG_FILE_PREFIX
    // 前缀，不会被扫描到，符合"不迁移不删除、自然过期"的方案约定。
    if (!entry.startsWith(MAIN_LOG_FILE_PREFIX) || !entry.endsWith('.log')) {
      continue
    }

    const filePath = path.join(logDir, entry)
    try {
      const stat = await fs.stat(filePath)
      if (stat.isFile()) {
        stats.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size })
      }
    } catch {
      // 统计过程中文件被删除或不可访问，跳过即可
    }
  }

  return stats
}

async function removeFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true }).catch(() => undefined)
}

async function removeExpiredFiles(files: LogFileStat[]): Promise<LogFileStat[]> {
  const cutoff = Date.now() - MAIN_LOG_RETENTION_DAYS * MS_PER_DAY
  const remaining: LogFileStat[] = []

  for (const file of files) {
    if (file.mtimeMs < cutoff) {
      await removeFile(file.filePath)
      continue
    }
    remaining.push(file)
  }

  return remaining
}

async function enforceTotalSizeLimit(files: LogFileStat[]): Promise<void> {
  let totalSize = files.reduce((sum, file) => sum + file.size, 0)
  if (totalSize <= MAIN_LOG_MAX_TOTAL_BYTES) {
    return
  }

  const sortedByOldest = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const file of sortedByOldest) {
    if (totalSize <= MAIN_LOG_MAX_TOTAL_BYTES) {
      break
    }
    await removeFile(file.filePath)
    totalSize -= file.size
  }
}

/**
 * 日志保留清理：应用启动时调用一次，只处理 `henji-*.log`（新命名规则），
 * 旧的 `frontend-*.log` 不在扫描范围内，不迁移不删除，自然过期。
 * 1. 删除早于 `MAIN_LOG_RETENTION_DAYS` 天的 `henji-*.log` 文件；
 * 2. 检查日志目录剩余总大小，超过 `MAIN_LOG_MAX_TOTAL_BYTES` 时从最旧文件开始删除，
 *    直到目录总大小回落到上限以内。
 */
export async function runLogRetention(): Promise<void> {
  const logDir = getLogDir()
  const files = await listLogFiles(logDir)
  const remaining = await removeExpiredFiles(files)
  await enforceTotalSizeLimit(remaining)
}
