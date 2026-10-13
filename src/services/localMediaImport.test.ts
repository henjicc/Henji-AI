import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  desktop: true,
  files: vi.fn(),
  image: vi.fn(),
  getPathForFile: vi.fn(),
  importFromPath: vi.fn(),
  importFromBytes: vi.fn(),
  resolveLargeUploadAction: vi.fn(),
}))
vi.mock('@/commands/clipboard', () => ({ readClipboardFiles: mocks.files, readClipboardImage: mocks.image }))

vi.mock('@/platform/desktopApi', () => ({
  getPathForFile: mocks.getPathForFile,
}))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => mocks.desktop,
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

import { importLocalMedia, inferLocalMediaKind, readClipboardImageSource } from './localMediaImport'
import { useSettingsStore } from '@/stores/settingsStore'
const initialStrategy = useSettingsStore.getState().largeUploadStrategy
afterEach(async () => {
  useSettingsStore.setState({ largeUploadStrategy: initialStrategy })
  const policy = await vi.importActual<typeof import('./largeUploadPolicy')>('./largeUploadPolicy')
  policy.useLargeUploadPromptStore.setState({ queue: [] })
})

describe('localMediaImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.desktop = true
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
    expect(inferLocalMediaKind({ name: 'e.MXF', type: 'application/mxf' })).toBe('video')
    expect(inferLocalMediaKind({ name: 'f.mts', type: 'model/vnd.mts' })).toBe('video')
    expect(inferLocalMediaKind({ name: 'd.pdf', type: 'application/pdf' })).toBeNull()
  })

  it('大视频与小图片混合复制时只返回图片路径，不读取位图', async () => {
    const image = { path: path.resolve(path.sep, 'media', 'small.png'), mimeType: 'image/png', size: 42 }
    mocks.files.mockResolvedValue([{ path: path.resolve(path.sep, 'media', 'big.mp4'), mimeType: 'video/mp4', size: 2 * 1024 ** 3 }, image])
    expect(await readClipboardImageSource()).toEqual(image)
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('没有图片路径时保留截图回退，读取文件列表失败不掩盖错误', async () => {
    mocks.files.mockResolvedValue([])
    const image = { dataUrl: 'data:image/png;base64,aQ==', name: '截图', origin: 'bitmap' }
    mocks.image.mockResolvedValue(image)
    expect(await readClipboardImageSource()).toEqual(image)
    mocks.image.mockClear()
    mocks.files.mockRejectedValue(new Error('剪贴板不可读'))
    await expect(readClipboardImageSource()).rejects.toThrow('剪贴板不可读')
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('路径元数据实际经过100MiB复制边界和复制、引用、询问策略', async () => {
    const policy = await vi.importActual<typeof import('./largeUploadPolicy')>('./largeUploadPolicy')
    mocks.resolveLargeUploadAction.mockImplementation(policy.resolveLargeUploadAction)
    const entry = { path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 100 * 1024 ** 2 }
    mocks.importFromPath.mockImplementation(async (request) => ({ kind: 'image', fullPath: request.sourcePath, ownership: request.ownership }))
    useSettingsStore.setState({ largeUploadStrategy: 'ask' })
    expect((await importLocalMedia(entry, 'image')).ownership).toBe('managed')
    expect(policy.useLargeUploadPromptStore.getState().queue).toHaveLength(0)
    entry.size++
    for (const strategy of ['copy', 'reference'] as const) {
      useSettingsStore.setState({ largeUploadStrategy: strategy })
      expect((await importLocalMedia(entry, 'image')).ownership).toBe(strategy === 'copy' ? 'managed' : 'referenced')
    }
    useSettingsStore.setState({ largeUploadStrategy: 'ask' })
    const pending = importLocalMedia(entry, 'image')
    expect(policy.useLargeUploadPromptStore.getState().queue[0].fileName).toBe('large.png')
    policy.useLargeUploadPromptStore.getState().settleCurrent('reference', false)
    expect((await pending).ownership).toBe('referenced')
    expect(mocks.importFromBytes).not.toHaveBeenCalled()
  })

  it('剪贴板路径元数据保留真实大小与名称，引用导入不访问 File 或字节', async () => {
    const entry = { path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 2 * 1024 ** 3 }
    mocks.resolveLargeUploadAction.mockResolvedValue('reference')
    mocks.importFromPath.mockResolvedValue({ kind: 'image', fullPath: entry.path })
    await importLocalMedia(entry, 'image')
    expect(mocks.getPathForFile).not.toHaveBeenCalled()
    expect(mocks.resolveLargeUploadAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'large.png', size: entry.size }), entry.path)
    expect(mocks.importFromPath).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: entry.path, ownership: 'referenced', mimeType: 'image/png' }))
    expect(mocks.importFromBytes).not.toHaveBeenCalled()
  })
})
