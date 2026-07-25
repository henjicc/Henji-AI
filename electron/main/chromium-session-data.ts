import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createMainLogger } from './services/logging/main-logger'

const logger = createMainLogger('main.chromium_session')
const SESSION_DATA_DIRECTORY_NAME = 'ChromiumSessionData'
const DEVELOPMENT_USER_DATA_PREFIX = 'Henji-AI-dev-'

/**
 * 为每个开发 worktree 分配独立的 Electron 用户数据目录，再将可再生 Chromium
 * 会话缓存置于其中。这样运行中的其他 worktree 不会共享 GPU/网络缓存锁、数据库
 * 或密钥；打包应用仍保留正式用户数据目录。
 */
export function configureChromiumSessionData(): void {
  configureDevelopmentUserData()
  const sessionDataPath = path.join(
    app.getPath('userData'),
    SESSION_DATA_DIRECTORY_NAME
  )
  try {
    fs.mkdirSync(sessionDataPath, { recursive: true })
    fs.accessSync(sessionDataPath, fs.constants.R_OK | fs.constants.W_OK)
    app.setPath('sessionData', sessionDataPath)
    logger.info('Chromium 会话缓存目录已初始化', {
      event: 'chromium_session.initialize.completed',
      context: { configured: true },
    })
  } catch {
    // 不阻止应用启动：缓存错误不能被等同为 WebGPU 不可用，实际能力由 Worker 单独探测。
    logger.warn('Chromium 会话缓存目录不可写，保留 Electron 默认目录', {
      event: 'chromium_session.initialize.failed',
      context: { configured: false, reason: 'session-data-not-writable' },
    })
  }
}

function configureDevelopmentUserData(): void {
  if (app.isPackaged) return
  const workspaceId = createHash('sha256')
    .update(process.cwd())
    .digest('hex')
    .slice(0, 12)
  const developmentUserDataPath = path.join(
    app.getPath('appData'),
    `${DEVELOPMENT_USER_DATA_PREFIX}${workspaceId}`
  )
  try {
    fs.mkdirSync(developmentUserDataPath, { recursive: true })
    fs.accessSync(developmentUserDataPath, fs.constants.R_OK | fs.constants.W_OK)
    app.setPath('userData', developmentUserDataPath)
    logger.info('开发态 Electron 用户数据目录已隔离', {
      event: 'chromium_session.user_data.isolated',
      context: { development: true, workspaceScoped: true },
    })
  } catch {
    // 保留 Electron 默认目录并继续启动；实际 WebGPU 可用性由 Worker 单独探测。
    logger.warn('开发态 Electron 用户数据目录不可写，保留默认目录', {
      event: 'chromium_session.user_data.isolation_failed',
      context: { development: true, reason: 'user-data-not-writable' },
    })
  }
}
