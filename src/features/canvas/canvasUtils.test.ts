/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { resolveMediaFileKind, resolveMediaFiles } from './canvasUtils'

describe('canvas media file resolution', () => {
  it('按 MIME 识别图片、视频和音频', () => {
    expect(resolveMediaFileKind(new File([], 'image.bin', { type: 'image/png' }))).toBe('image')
    expect(resolveMediaFileKind(new File([], 'video.bin', { type: 'video/mp4' }))).toBe('video')
    expect(resolveMediaFileKind(new File([], 'audio.bin', { type: 'audio/mpeg' }))).toBe('audio')
  })

  it('Windows 未提供 MIME 时回退到扩展名并过滤不支持文件', () => {
    const files = [
      new File([], 'photo.WEBP'),
      new File([], 'clip.mov'),
      new File([], 'sound.flac'),
      new File([], 'notes.txt'),
    ]

    expect(resolveMediaFiles(files).map((item) => item.kind)).toEqual(['image', 'video', 'audio'])
  })
})
