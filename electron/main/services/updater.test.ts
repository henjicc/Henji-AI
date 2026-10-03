import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const updater = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return updater
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    autoDownload: true,
    autoInstallOnAppQuit: false,
    forceDevUpdateConfig: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const sent: unknown[] = []
  return { updater, logger, sent }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '2.0.0-beta.1', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel: string, event: unknown) => mocks.sent.push(event) } }] },
}))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }))
vi.mock('./logging', () => ({ createMainLogger: () => mocks.logger }))

import { checkForElectronUpdates, isNoUpdateMetadataError } from './updater'

function updaterError(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {})
}

/** 与 electron-updater AppUpdater.checkForUpdates 相同：先发 checking，失败时先 emit('error') 再拒绝。 */
function failCheckWith(error: Error): void {
  mocks.updater.checkForUpdates.mockImplementation(async () => {
    mocks.updater.emit('checking-for-update')
    mocks.updater.emit('error', error, String(error.stack))
    throw error
  })
}

describe('自动更新：发布源没有更新元数据', () => {
  beforeEach(() => {
    process.env['HENJI_UPDATER_ALLOW_DEV'] = '1'
    vi.clearAllMocks()
    mocks.sent.length = 0
  })

  it('只认“没有通道文件 / 没有任何发布”两种错误码', () => {
    expect(isNoUpdateMetadataError(updaterError('Cannot find latest.yml', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'))).toBe(true)
    expect(isNoUpdateMetadataError(updaterError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'))).toBe(true)
    expect(isNoUpdateMetadataError(updaterError('Unable to find latest version', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'))).toBe(false)
    expect(isNoUpdateMetadataError(updaterError('net::ERR_INTERNET_DISCONNECTED'))).toBe(false)
    expect(isNoUpdateMetadataError('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')).toBe(false)
  })

  it('最新 Release 没有 latest.yml：返回暂无可用更新，记 warn，不发 error 事件也不记 error', async () => {
    failCheckWith(updaterError('Cannot find latest.yml in the latest release artifacts (…/v0.1.1/latest.yml): HttpError: 404', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'))
    const result = await checkForElectronUpdates()
    expect(result).toMatchObject({ status: 'not-available', hasUpdate: false, currentVersion: '2.0.0-beta.1' })
    expect(result.errorMessage).toBeUndefined()
    expect(mocks.logger.error).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn.mock.calls[0][1]).toMatchObject({ event: 'updater.metadata.missing', context: { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' } })
    expect(mocks.sent.map((event) => (event as { type: string }).type)).toEqual(['checking', 'not-available'])
  })

  it('网络等真实失败仍按 error：记 error、发 error 事件并向调用方抛出', async () => {
    failCheckWith(updaterError('net::ERR_CONNECTION_RESET'))
    await expect(checkForElectronUpdates()).rejects.toThrow('ERR_CONNECTION_RESET')
    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error.mock.calls[0][1]).toMatchObject({ event: 'updater.status.failed' })
    expect(mocks.logger.warn).not.toHaveBeenCalled()
    expect(mocks.sent.map((event) => (event as { type: string }).type)).toEqual(['checking', 'error'])
  })
})

