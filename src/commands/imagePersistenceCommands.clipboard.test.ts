import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeImageFromSource: vi.fn(), writeImageFromPath: vi.fn(), persistImageSource: vi.fn(),
}))
vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => true,
  getPlatform: () => ({ clipboard: mocks, image: mocks }),
}))

import { copyImageSourceToClipboard } from './imagePersistenceCommands'

describe('桌面图片复制失败收口', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('原生复制失败时保留原错误，不再次落盘或重复解码复制', async () => {
    const failure = new Error('Clipboard is unavailable')
    mocks.writeImageFromSource.mockRejectedValue(failure)
    await expect(copyImageSourceToClipboard('/image.png')).rejects.toBe(failure)
    expect(mocks.writeImageFromSource).toHaveBeenCalledTimes(1)
    expect(mocks.persistImageSource).not.toHaveBeenCalled()
    expect(mocks.writeImageFromPath).not.toHaveBeenCalled()
  })

  it('成功时只调用统一源图复制入口', async () => {
    await copyImageSourceToClipboard('data:image/png;base64,cG5n')
    expect(mocks.writeImageFromSource).toHaveBeenCalledWith('data:image/png;base64,cG5n')
    expect(mocks.persistImageSource).not.toHaveBeenCalled()
  })
})
