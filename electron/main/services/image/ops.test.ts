import { describe, expect, it } from 'vitest'

import { readImageInfo } from './ops'
import { loadSharp } from './sharp-loader'

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

describe('readImageInfo', () => {
  it('读取透明通道并在没有 EXIF 方向时返回 null', async () => {
    const sharp = await loadSharp()
    const bytes = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.5 },
      },
    }).png().toBuffer()

    await expect(readImageInfo(dataUrl('image/png', bytes))).resolves.toMatchObject({
      extension: 'png',
      width: 12,
      height: 8,
      orientation: null,
      hasAlpha: true,
      fileSizeBytes: bytes.length,
    })
  })

  it('保留原始像素尺寸与 EXIF 方向供调用方计算视觉宽高', async () => {
    const sharp = await loadSharp()
    const bytes = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer()

    await expect(readImageInfo(dataUrl('image/jpeg', bytes))).resolves.toMatchObject({
      extension: 'jpg',
      width: 12,
      height: 8,
      orientation: 6,
      hasAlpha: false,
    })
  })
})
