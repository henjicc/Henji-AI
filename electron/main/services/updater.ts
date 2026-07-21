import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { createMainLogger } from './logging'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterReleaseInfoDto {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface UpdaterProgressInfoDto {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdaterCheckResultDto {
  status: UpdaterStatus
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: UpdaterReleaseInfoDto
  progress?: UpdaterProgressInfoDto
  errorMessage?: string
}

export type UpdaterEventDto =
  | { type: 'checking'; result: UpdaterCheckResultDto }
  | { type: 'available'; result: UpdaterCheckResultDto }
  | { type: 'not-available'; result: UpdaterCheckResultDto }
  | { type: 'download-progress'; result: UpdaterCheckResultDto }
  | { type: 'downloaded'; result: UpdaterCheckResultDto }
  | { type: 'error'; result: UpdaterCheckResultDto }

const RELEASES_URL = 'https://github.com/henjicc/Henji-AI/releases'

const logger = createMainLogger('main.updater')

let currentStatus: UpdaterCheckResultDto = {
  status: 'idle',
  hasUpdate: false,
  currentVersion: app.getVersion(),
}

let configured = false

function releaseNotesToText(releaseNotes: UpdateInfo['releaseNotes']): string {
  if (typeof releaseNotes === 'string') {
    return releaseNotes
  }
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (typeof note === 'string') return note
        if (note && typeof note === 'object' && 'note' in note && typeof note.note === 'string') {
          return note.note
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function toReleaseInfo(info: UpdateInfo): UpdaterReleaseInfoDto {
  return {
    version: info.version,
    name: info.releaseName || `v${info.version}`,
    body: releaseNotesToText(info.releaseNotes),
    publishedAt: info.releaseDate || new Date().toISOString(),
    htmlUrl: `${RELEASES_URL}/tag/v${info.version}`,
  }
}

function progressToDto(progress: ProgressInfo): UpdaterProgressInfoDto {
  return {
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  }
}

function emitUpdaterEvent(event: UpdaterEventDto): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:event', event)
    }
  })
}

function setStatus(type: UpdaterEventDto['type'], result: UpdaterCheckResultDto): UpdaterCheckResultDto {
  currentStatus = result
  const context = {
    status: result.status,
    hasUpdate: result.hasUpdate,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    progressPercent: result.progress?.percent,
  }
  if (type === 'error') {
    logger.error('自动更新状态变更', {
      event: 'updater.status.failed',
      context,
      error: result.errorMessage,
    })
  } else if (type === 'download-progress') {
    logger.debug('自动更新下载进度', {
      event: 'updater.download.progress',
      context,
    })
  } else {
    logger.info('自动更新状态变更', {
      event: `updater.status.${type}`,
      context,
    })
  }
  emitUpdaterEvent({ type, result } as UpdaterEventDto)
  return result
}

function makeBaseStatus(status: UpdaterStatus): UpdaterCheckResultDto {
  return {
    status,
    hasUpdate: false,
    currentVersion: app.getVersion(),
  }
}

function configureUpdater(): void {
  if (configured) return
  configured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  if (process.env['HENJI_UPDATER_ALLOW_DEV'] === '1') {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('checking-for-update', () => {
    setStatus('checking', makeBaseStatus('checking'))
  })

  autoUpdater.on('update-available', (info) => {
    setStatus('available', {
      status: 'available',
      hasUpdate: true,
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseInfo: toReleaseInfo(info),
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setStatus('not-available', {
      status: 'not-available',
      hasUpdate: false,
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseInfo: toReleaseInfo(info),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus('download-progress', {
      ...currentStatus,
      status: 'downloading',
      hasUpdate: true,
      currentVersion: app.getVersion(),
      progress: progressToDto(progress),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus('downloaded', {
      status: 'downloaded',
      hasUpdate: true,
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseInfo: toReleaseInfo(info),
    })
  })

  autoUpdater.on('error', (error) => {
    setStatus('error', {
      ...makeBaseStatus('error'),
      errorMessage: error.message,
    })
  })
}

function isUpdaterEnabledInThisEnvironment(): boolean {
  if (process.env['HENJI_UPDATER_ALLOW_DEV'] === '1') {
    return true
  }
  if (!app.isPackaged) {
    return false
  }
  return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
}

export function initializeUpdater(): void {
  configureUpdater()
}

export function getUpdaterStatus(): UpdaterCheckResultDto {
  return currentStatus
}

export async function checkForElectronUpdates(): Promise<UpdaterCheckResultDto> {
  configureUpdater()

  if (!isUpdaterEnabledInThisEnvironment()) {
    return setStatus('not-available', {
      ...makeBaseStatus('not-available'),
      errorMessage: 'Updater is disabled until packaged with publish metadata',
    })
  }

  const result = await autoUpdater.checkForUpdates()
  if (!result?.updateInfo) {
    return currentStatus
  }

  if (currentStatus.status === 'checking') {
    return setStatus('not-available', {
      status: 'not-available',
      hasUpdate: false,
      currentVersion: app.getVersion(),
      latestVersion: result.updateInfo.version,
      releaseInfo: toReleaseInfo(result.updateInfo),
    })
  }

  return currentStatus
}

export async function downloadElectronUpdate(): Promise<UpdaterCheckResultDto> {
  configureUpdater()

  if (!isUpdaterEnabledInThisEnvironment()) {
    return setStatus('error', {
      ...makeBaseStatus('error'),
      errorMessage: 'Updater is disabled until packaged with publish metadata',
    })
  }

  if (!currentStatus.hasUpdate) {
    throw new Error('No update is available to download')
  }

  setStatus('download-progress', {
    ...currentStatus,
    status: 'downloading',
  })
  await autoUpdater.downloadUpdate()
  return currentStatus
}

export function quitAndInstallElectronUpdate(): void {
  configureUpdater()
  autoUpdater.quitAndInstall(false, true)
}
