import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelRuntimeDefinition } from '@henjicc/ai-sdk'

const mocks = vi.hoisted(() => ({
  videoSize: { width: 1920, height: 1080 },
  scaleVideo: vi.fn(async (_source: string, width: number, height: number) => `D:/uploads/fit-${width}x${height}.mp4`),
}))

vi.mock('../media/shared', () => ({
  resolveLocalMediaPath: vi.fn(async (source: string) => source.startsWith('https://') ? 'D:/uploads/downloaded.mp4' : source.replace('file:///', '')),
}))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../image/path-utils', () => ({ getUploadsDir: () => 'D:/uploads' }))
vi.mock('../image/sharp-loader', () => ({ loadSharp: vi.fn() }))
vi.mock('../video/ops', () => ({
  readVideoInfo: vi.fn(async () => mocks.videoSize),
  scaleVideoToDimensions: mocks.scaleVideo,
}))

import { conformGenerationMedia } from './media-conform'

const model = {
  meta: { id: 'pixel-limited' },
  params: [{ id: 'first_frame', type: 'video-upload' }],
  inputLimits: { videos: { max: 2 }, rules: [{ videoConstraints: { maxPixels: 927408 } }] },
} as unknown as ModelRuntimeDefinition

describe('提交前按模型尺寸要求缩放参考素材', () => {
  beforeEach(() => {
    mocks.scaleVideo.mockClear()
    mocks.videoSize = { width: 1920, height: 1080 }
  })

  it('超出总像素上限的视频缩放一次，上传路径与显示地址一并换成缩放后的文件', async () => {
    const params = { uploadedVideoFilePaths: ['D:/clip.mp4'], videos: ['file:///D:/clip.mp4'], prompt: '镜头' }
    const next = await conformGenerationMedia(model, params, {})
    expect(mocks.scaleVideo).toHaveBeenCalledTimes(1)
    const [, width, height] = mocks.scaleVideo.mock.calls[0]
    expect(width * height).toBeLessThanOrEqual(927408)
    expect(next.uploadedVideoFilePaths).toEqual([`D:/uploads/fit-${width}x${height}.mp4`])
    expect(next.videos).toEqual([`D:/uploads/fit-${width}x${height}.mp4`])
    expect(next.prompt).toBe('镜头')
    expect(params.videos).toEqual(['file:///D:/clip.mp4'])
  })

  it('远程素材下载后同样缩放，替换掉原地址', async () => {
    const next = await conformGenerationMedia(model, { first_frame: 'https://example.test/a.mp4' }, {})
    expect(mocks.scaleVideo.mock.calls[0][0]).toBe('D:/uploads/downloaded.mp4')
    expect(next.first_frame).toMatch(/^D:\/uploads\/fit-/)
  })

  it('合格素材原样交出', async () => {
    mocks.videoSize = { width: 1280, height: 720 }
    const params = { uploadedVideoFilePaths: ['D:/clip.mp4'], first_frame: 'https://example.test/a.mp4' }
    await expect(conformGenerationMedia(model, params, {})).resolves.toBe(params)
    expect(mocks.scaleVideo).not.toHaveBeenCalled()
  })
})
