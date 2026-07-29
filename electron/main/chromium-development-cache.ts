import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createMainLogger } from './services/logging/main-logger'

const logger = createMainLogger('main.chromium_cache')
const DEVELOPMENT_CACHE_PREFIX = 'henji-electron-cache-'

/**
 * 开发态按源码目录隔离可再生的 Chromium 磁盘缓存，避免多个 worktree
 * 争抢网络/GPU 缓存。不改动 userData 或 sessionData，因为 Electron safeStorage
 * 的加密上下文依赖其中稳定的 Chromium Local State。
 */
export function configureChromiumDevelopmentCache(): void {
  if (app.isPackaged) return

  const workspaceId = createHash('sha256')
    .update(process.cwd())
    .digest('hex')
    .slice(0, 12)
  const cachePath = path.join(
    app.getPath('temp'),
    `${DEVELOPMENT_CACHE_PREFIX}${workspaceId}`
  )

  try {
    fs.mkdirSync(cachePath, { recursive: true })
    fs.accessSync(cachePath, fs.constants.R_OK | fs.constants.W_OK)
    app.commandLine.appendSwitch('disk-cache-dir', cachePath)
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
    logger.info('开发态 Chromium 磁盘缓存已隔离', {
      event: 'chromium_cache.initialize.completed',
      context: { configured: true, workspaceScoped: true },
    })
  } catch {
    // 缓存错误不能被等同为 WebGPU 不可用，实际能力由 Worker 单独探测。
    logger.warn('Chromium 磁盘缓存目录不可写，保留 Electron 默认配置', {
      event: 'chromium_cache.initialize.failed',
      context: { configured: false, reason: 'cache-directory-not-writable' },
    })
  }
}
