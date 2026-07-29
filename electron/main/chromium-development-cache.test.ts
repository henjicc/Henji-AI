import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  mkdirSync: vi.fn(),
  accessSync: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => name === 'temp' ? 'C:\\Temp' : 'unexpected'),
    commandLine: { appendSwitch: mocks.appendSwitch },
  },
}))

vi.mock('node:fs', () => ({
  default: {
    constants: { R_OK: 4, W_OK: 2 },
    mkdirSync: mocks.mkdirSync,
    accessSync: mocks.accessSync,
  },
}))

vi.mock('./services/logging/main-logger', () => ({
  createMainLogger: () => ({ info: mocks.info, warn: mocks.warn }),
}))

import { configureChromiumDevelopmentCache } from './chromium-development-cache'

describe('configureChromiumDevelopmentCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('只隔离可再生缓存，不改动 safeStorage 依赖的数据目录', () => {
    configureChromiumDevelopmentCache()

    expect(mocks.mkdirSync).toHaveBeenCalledOnce()
    expect(mocks.accessSync).toHaveBeenCalledOnce()
    expect(mocks.appendSwitch).toHaveBeenCalledWith(
      'disk-cache-dir',
      expect.stringMatching(/henji-electron-cache-[a-f0-9]{12}$/)
    )
    expect(mocks.appendSwitch).toHaveBeenCalledWith('disable-gpu-shader-disk-cache')
    expect(mocks.info).toHaveBeenCalledOnce()
    expect(mocks.warn).not.toHaveBeenCalled()
  })
})
