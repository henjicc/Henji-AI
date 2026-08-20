import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPathForFile: vi.fn(),
  importFromPath: vi.fn(),
  importFromBytes: vi.fn(),
  resolveLargeUploadAction: vi.fn(),
}))

vi.mock('@/platform/desktopApi', () => ({
  getPathForFile: mocks.getPathForFile,
}))
vi.mock('@/platform/runtime', () => ({
  getPlatform: () => ({
    media: {
      importFromPath: mocks.importFromPath,
      importFromBytes: mocks.importFromBytes,
    },
  }),
}))
vi.mock('@/services/largeUploadPolicy', () => ({
  resolveLargeUploadAction: mocks.resolveLargeUploadAction,
}))

import { importLocalMedia, inferLocalMediaKind } from './localMediaImport'

describe('localMediaImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveLargeUploadAction.mockResolvedValue('copy')
  })

  it('路径来源只传路径和选项，不读取 File bytes', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' })
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer')
    mocks.getPathForFile.mockReturnValue('C:/media/clip.mp4')
    mocks.importFromPath.mockResolvedValue({ kind: 'video', fullPath: 'C:/managed/clip.mp4' })

    await importLocalMedia(file, 'video')

    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(mocks.importFromPath).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: 'C:/media/clip.mp4',
      expectedKind: 'video',
      ownership: 'managed',
    }))
    expect(mocks.importFromBytes).not.toHaveBeenCalled()
  })

  it('无真实路径时只走 bytes 后备', async () => {
    const file = new File([new Uint8Array([0x49, 0x44, 0x33])], 'voice.mp3', { type: 'audio/mpeg' })
    mocks.getPathForFile.mockReturnValue('')
    mocks.importFromBytes.mockResolvedValue({ kind: 'audio', fullPath: 'C:/managed/voice.mp3' })

    await importLocalMedia(file, 'audio')

    expect(mocks.importFromBytes).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'voice.mp3',
      expectedKind: 'audio',
      bytes: expect.any(Uint8Array),
    }))
    expect(mocks.importFromPath).not.toHaveBeenCalled()
  })

  it('按 MIME 或扩展名识别三类媒体并拒绝不支持格式', () => {
    expect(inferLocalMediaKind({ name: 'a.bin', type: 'image/png' })).toBe('image')
    expect(inferLocalMediaKind({ name: 'b.webm', type: '' })).toBe('video')
    expect(inferLocalMediaKind({ name: 'c.flac', type: '' })).toBe('audio')
    expect(inferLocalMediaKind({ name: 'd.pdf', type: 'application/pdf' })).toBeNull()
  })
})
