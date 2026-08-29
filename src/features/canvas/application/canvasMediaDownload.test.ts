import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import {
  downloadCanvasMediaTargetsToDirectory,
  resolveNodeDownloadTargets,
  saveCanvasMediaTargetAs,
} from './canvasMediaDownload'

const mocks = vi.hoisted(() => ({
  saveImageSourceToDirectory: vi.fn(),
  saveImageSourceToPath: vi.fn(),
  savePanoramaImageSourceToDirectory: vi.fn(),
  savePanoramaImageSourceToPath: vi.fn(),
  saveDialog: vi.fn(),
  quickDownloadMediaFile: vi.fn(),
  resolveLocalAssetPath: vi.fn((source: string) => source),
}))

vi.mock('@/commands/image', () => ({
  saveImageSourceToDirectory: mocks.saveImageSourceToDirectory,
  saveImageSourceToPath: mocks.saveImageSourceToPath,
  savePanoramaImageSourceToDirectory: mocks.savePanoramaImageSourceToDirectory,
  savePanoramaImageSourceToPath: mocks.savePanoramaImageSourceToPath,
}))
vi.mock('@/platform/desktopApi', () => ({ saveDialog: mocks.saveDialog }))
vi.mock('@/features/assets/services/assetCollectionService', () => ({
  resolveLocalAssetPath: mocks.resolveLocalAssetPath,
}))
vi.mock('@/utils/save', () => ({
  downloadMediaFile: vi.fn(),
  quickDownloadMediaFile: mocks.quickDownloadMediaFile,
  saveAudioFromUrl: vi.fn(),
  saveVideoFromUrl: vi.fn(),
}))

function node(id: string, type: CanvasNode['type'], data: Record<string, unknown>): CanvasNode {
  return {
    id,
    type,
    data: data as CanvasNode['data'],
    position: { x: 0, y: 0 },
  } as CanvasNode
}

describe('canvasMediaDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('只解析声明了下载能力且已有结果的媒体节点', () => {
    const targets = resolveNodeDownloadTargets([
      node('image', CANVAS_NODE_TYPES.exportImage, { imageUrl: 'D:/result.png' }),
      node('video', CANVAS_NODE_TYPES.exportVideo, { videoUrl: 'D:/result.mp4' }),
      node('audio', CANVAS_NODE_TYPES.exportAudio, { audioUrl: 'D:/result.mp3' }),
      node('generator', CANVAS_NODE_TYPES.videoGen, { modelId: 'model', prompt: '', params: {} }),
    ])

    expect(targets.map((target) => target.mediaType)).toEqual(['image', 'video', 'audio'])
    expect(targets.map((target) => target.nodeId)).toEqual(['image', 'video', 'audio'])
  })

  it('批量下载逐项隔离失败并返回真实成功结果', async () => {
    mocks.saveImageSourceToDirectory.mockResolvedValue('D:/downloads/node-image.png')
    mocks.quickDownloadMediaFile
      .mockResolvedValueOnce('D:/downloads/node-video.mp4')
      .mockRejectedValueOnce(new Error('disk error'))
    const targets = resolveNodeDownloadTargets([
      node('image', CANVAS_NODE_TYPES.exportImage, { imageUrl: 'D:/result.png' }),
      node('video', CANVAS_NODE_TYPES.exportVideo, { videoUrl: 'D:/result.mp4' }),
      node('audio', CANVAS_NODE_TYPES.exportAudio, { audioUrl: 'D:/result.mp3' }),
    ])

    const summary = await downloadCanvasMediaTargetsToDirectory(targets, 'D:/downloads', 'preset')

    expect(summary).toEqual({
      requestedCount: 3,
      savedNodeIds: ['image', 'video'],
      failedNodeIds: ['audio'],
    })
  })

  it('全景结果下载前写入 GPano，普通图片保持原链路', async () => {
    mocks.savePanoramaImageSourceToDirectory.mockResolvedValue('D:/downloads/node-panorama.jpg')
    mocks.saveImageSourceToDirectory.mockResolvedValue('D:/downloads/node-panorama.jpg')
    const targets = resolveNodeDownloadTargets([
      node('panorama', CANVAS_NODE_TYPES.exportImage, {
        imageUrl: 'D:/result.jpg',
        resultKind: 'panorama',
      }),
      node('ordinary', CANVAS_NODE_TYPES.exportImage, {
        imageUrl: 'D:/ordinary.png',
        resultKind: 'image',
      }),
    ])

    expect(targets.map((target) => target.panorama)).toEqual([true, false])
    const summary = await downloadCanvasMediaTargetsToDirectory(targets, 'D:/downloads', 'preset')

    expect(summary.failedNodeIds).toEqual([])
    expect(mocks.savePanoramaImageSourceToDirectory).toHaveBeenCalledWith(
      'D:/result.jpg',
      'D:/downloads',
      'node-panorama',
    )
    expect(mocks.saveImageSourceToDirectory).toHaveBeenCalledWith(
      'D:/ordinary.png',
      'D:/downloads',
      'node-ordinary',
    )
  })

  it('取消全景另存为时不编码或落盘中间文件', async () => {
    mocks.saveDialog.mockResolvedValue(null)
    const target = resolveNodeDownloadTargets([
      node('panorama', CANVAS_NODE_TYPES.exportImage, {
        imageUrl: 'D:/result.png',
        resultKind: 'panorama',
      }),
    ])[0]

    await expect(saveCanvasMediaTargetAs(target)).resolves.toBeNull()
    expect(mocks.savePanoramaImageSourceToPath).not.toHaveBeenCalled()
    expect(mocks.saveImageSourceToPath).not.toHaveBeenCalled()
  })

  it('全景另存为由主进程直接写最终目标', async () => {
    mocks.saveDialog.mockResolvedValue('D:/downloads/panorama.png')
    mocks.savePanoramaImageSourceToPath.mockResolvedValue('D:/downloads/panorama.png')
    const target = resolveNodeDownloadTargets([
      node('panorama', CANVAS_NODE_TYPES.exportImage, {
        imageUrl: 'D:/result.png',
        resultKind: 'panorama',
      }),
    ])[0]

    await expect(saveCanvasMediaTargetAs(target)).resolves.toBe('D:/downloads/panorama.png')
    expect(mocks.savePanoramaImageSourceToPath).toHaveBeenCalledWith(
      'D:/result.png',
      'D:/downloads/panorama.png',
    )
    expect(mocks.saveImageSourceToPath).not.toHaveBeenCalled()
  })
})
