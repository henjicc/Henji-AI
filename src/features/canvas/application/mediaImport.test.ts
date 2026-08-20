import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  importLocalMedia: vi.fn(),
}))

vi.mock('@/services/localMediaImport', () => ({
  importLocalMedia: mocks.importLocalMedia,
}))

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import {
  importCanvasMediaFile,
  UnsupportedCanvasMediaError,
  validateCanvasMediaFile,
} from './mediaImport'

describe('importCanvasMediaFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('识别图片并返回图片源节点数据', async () => {
    mocks.importLocalMedia.mockResolvedValue({
      kind: 'image',
      fullPath: 'C:/media/image.png',
      previewPath: 'C:/media/image-preview.jpg',
      aspectRatio: '4:3',
    })
    const result = await importCanvasMediaFile(new File([], 'image.png', { type: 'image/png' }))
    expect(result).toMatchObject({
      kind: 'image',
      type: CANVAS_NODE_TYPES.upload,
      data: { imageUrl: 'C:/media/image.png', aspectRatio: '4:3', sourceFileName: 'image.png' },
    })
  })

  it('识别视频并复用持久化、封面与时长信息', async () => {
    mocks.importLocalMedia.mockResolvedValue({
      kind: 'video',
      fullPath: 'C:/media/video.mp4',
      posterPath: 'C:/media/video.jpg',
      aspectRatio: '16:9',
      durationSeconds: 8,
      hasAudio: true,
    })
    const result = await importCanvasMediaFile(new File([], 'video.mp4', { type: 'video/mp4' }))
    expect(result).toMatchObject({
      kind: 'video',
      type: CANVAS_NODE_TYPES.videoUpload,
      data: { videoUrl: 'C:/media/video.mp4', durationSec: 8, hasAudio: true, sourceFileName: 'video.mp4' },
    })
  })

  it('识别音频并复用持久化与时长读取', async () => {
    mocks.importLocalMedia.mockResolvedValue({
      kind: 'audio',
      fullPath: 'C:/media/audio.mp3',
      durationSeconds: 12.5,
    })
    const result = await importCanvasMediaFile(new File([], 'audio.mp3', { type: 'audio/mpeg' }))
    expect(result).toMatchObject({
      kind: 'audio',
      type: CANVAS_NODE_TYPES.audioUpload,
      data: { audioUrl: 'C:/media/audio.mp3', durationSec: 12.5, sourceFileName: 'audio.mp3' },
    })
  })

  it('不支持的格式不产生节点解析结果', async () => {
    await expect(importCanvasMediaFile(new File([], 'notes.pdf', { type: 'application/pdf' })))
      .rejects.toBeInstanceOf(UnsupportedCanvasMediaError)
  })

  it('连接锁定后只接受对应媒体类型', () => {
    expect(validateCanvasMediaFile(
      new File([], 'image.png', { type: 'image/png' }),
      'image',
    )).toEqual({ accepted: true, kind: 'image' })
    expect(validateCanvasMediaFile(
      new File([], 'video.mp4', { type: 'video/mp4' }),
      'image',
    )).toEqual({ accepted: false, reason: 'typeMismatch' })
    expect(validateCanvasMediaFile(
      new File([], 'notes.pdf', { type: 'application/pdf' }),
      null,
    )).toEqual({ accepted: false, reason: 'unsupported' })
  })
})
