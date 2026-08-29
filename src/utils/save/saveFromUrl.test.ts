import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveAudioFromUrl, saveBinary, saveVideoFromUrl } from './saveFromUrl'

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  join: vi.fn(),
  mkdir: vi.fn(),
  nativeFetch: vi.fn(),
  toDisplaySrc: vi.fn(),
  writeFile: vi.fn(),
  getMediaPath: vi.fn(),
  detectFileType: vi.fn(),
}))

vi.mock('@/platform/desktopApi', () => ({
  exists: mocks.exists,
  join: mocks.join,
  mkdir: mocks.mkdir,
  nativeFetch: mocks.nativeFetch,
  toDisplaySrc: mocks.toDisplaySrc,
  writeFile: mocks.writeFile,
}))
vi.mock('@/utils/dataPath', () => ({ getMediaPath: mocks.getMediaPath }))
vi.mock('@/utils/fileTypeDetector', () => ({ detectFileType: mocks.detectFileType }))

describe('saveFromUrl 受管媒体所有权', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMediaPath.mockResolvedValue('/data/Media')
    mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'))
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.exists.mockResolvedValue(false)
    mocks.toDisplaySrc.mockImplementation((value: string) => `display:${value}`)
    mocks.nativeFetch.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/octet-stream' },
    })
    mocks.detectFileType.mockImplementation(async ({ mediaType }: { mediaType: string }) => ({
      extension: mediaType === 'video' ? 'mp4' : 'mp3',
      mimeType: 'application/octet-stream',
      detectionMethod: 'content-type',
    }))
  })

  it('默认视频与音频文件名使用不同 UUID，并以排他方式创建', async () => {
    const video = await saveVideoFromUrl('https://example.test/video')
    const audio = await saveAudioFromUrl('https://example.test/audio')

    expect(video.created).toBe(true)
    expect(audio.created).toBe(true)
    expect(video.fullPath).not.toBe(audio.fullPath)
    expect(mocks.writeFile).toHaveBeenNthCalledWith(1, video.fullPath, expect.any(Uint8Array), { exclusive: true })
    expect(mocks.writeFile).toHaveBeenNthCalledWith(2, audio.fullPath, expect.any(Uint8Array), { exclusive: true })
  })

  it('显式文件名保留覆盖语义，且只把原本不存在的目标声明为新建', async () => {
    mocks.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(saveBinary(new Uint8Array([1]), 'existing.bin')).resolves.toMatchObject({ created: false })
    await expect(saveBinary(new Uint8Array([2]), 'new.bin')).resolves.toMatchObject({ created: true })

    expect(mocks.writeFile).toHaveBeenNthCalledWith(1, '/data/Media/existing.bin', expect.any(Uint8Array), {
      exclusive: false,
    })
    expect(mocks.writeFile).toHaveBeenNthCalledWith(2, '/data/Media/new.bin', expect.any(Uint8Array), {
      exclusive: false,
    })
  })
})
