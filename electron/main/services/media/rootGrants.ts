import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { getHenjiDataDir } from '../db'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.media')

const GRANTS_FILE_NAME = 'allowed-media-roots.json'
const MAX_PERSISTED_ROOTS = 100
const PERSIST_DEBOUNCE_MS = 500

interface PersistedGrantsFile {
  version: 1
  roots: Array<{ path: string; grantedAt: number }>
}

const grantedAtByRoot = new Map<string, number>()
let persistTimer: NodeJS.Timeout | null = null

function getGrantsFilePath(): string {
  return path.join(getHenjiDataDir(), GRANTS_FILE_NAME)
}

/**
 * 启动时恢复历史授权的媒体根目录。
 *
 * allowMediaRoot 的授权原本只存在内存里，重启即失效——项目里直接引用
 * 白名单默认目录之外的媒体文件（如资产库收录的原位置文件）重启后会 403。
 * 已消失的目录在恢复时静默丢弃。
 */
export function restorePersistedMediaRoots(allow: (rootPath: string) => void): void {
  let raw: string
  try {
    raw = fs.readFileSync(getGrantsFilePath(), 'utf8')
  } catch {
    return
  }

  try {
    const parsed = JSON.parse(raw) as PersistedGrantsFile
    if (parsed.version !== 1 || !Array.isArray(parsed.roots)) {
      return
    }
    let restored = 0
    for (const entry of parsed.roots) {
      if (typeof entry?.path !== 'string' || !entry.path.trim()) {
        continue
      }
      if (!fs.existsSync(entry.path)) {
        continue
      }
      grantedAtByRoot.set(entry.path, typeof entry.grantedAt === 'number' ? entry.grantedAt : Date.now())
      allow(entry.path)
      restored += 1
    }
    logger.info('已恢复持久化媒体授权目录', {
      event: 'media.root_grants.restore.completed',
      context: { restored, total: parsed.roots.length },
    })
  } catch (error) {
    logger.warn('媒体授权目录持久化文件解析失败，忽略', {
      event: 'media.root_grants.restore.failed',
      error,
    })
  }
}

function schedulePersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushPersist()
  }, PERSIST_DEBOUNCE_MS)
}

async function flushPersist(): Promise<void> {
  const roots = [...grantedAtByRoot.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PERSISTED_ROOTS)
    .map(([rootPath, grantedAt]) => ({ path: rootPath, grantedAt }))
  const payload: PersistedGrantsFile = { version: 1, roots }

  try {
    await fsp.mkdir(getHenjiDataDir(), { recursive: true })
    await fsp.writeFile(getGrantsFilePath(), JSON.stringify(payload), 'utf8')
  } catch (error) {
    logger.warn('媒体授权目录持久化写入失败', {
      event: 'media.root_grants.persist.failed',
      error,
    })
  }
}

/**
 * 记录一次"默认白名单之外"的目录授权并调度持久化。
 * 调用方（protocol.allowMediaRoot）负责判断该目录确实不在默认根目录覆盖范围内。
 */
export function persistMediaRootGrant(rootPath: string): void {
  grantedAtByRoot.set(rootPath, Date.now())
  schedulePersist()
}
