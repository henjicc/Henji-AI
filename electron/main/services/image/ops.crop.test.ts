import { describe, expect, it, vi } from 'vitest'
import { cropImageSource } from './ops'
import { loadSharp } from './sharp-loader'

// 替换落盘边界；解码、方向归一化与像素裁剪均走正式实现。
vi.mock('./path-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./path-utils')>(),
  persistImageBytes: (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`,
}))

const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`
const outputBytes = (value: string) => Buffer.from(value.split(',')[1], 'base64')

function regionPixels(pixels: Buffer, width: number, left: number, top: number, cropWidth: number, cropHeight: number) {
  return Buffer.concat(Array.from({ length: cropHeight }, (_, y) => (
    pixels.subarray(((top + y) * width + left) * 3, ((top + y) * width + left + cropWidth) * 3)
  )))
}

describe('生成前源图裁剪的像素保真', () => {
  it('竖图只移除上下边缘，保留区域每个像素原样不变', async () => {
    const sharp = await loadSharp()
    const width = 120, height = 200
    const pixels = Buffer.from(Array.from({ length: width * height * 3 }, (_, index) => index % 251))
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const result = await cropImageSource({ source: dataUrl(source), aspectRatio: '3:4' })
    const decoded = await sharp(outputBytes(result)).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 120, height: 160 })
    expect(decoded.data.equals(regionPixels(pixels, width, 0, 20, 120, 160))).toBe(true)
  })

  it.each([5, 6, 7, 8])('先应用 EXIF %s，再按可见画面裁剪，不旋错或拉伸', async (orientation) => {
    const sharp = await loadSharp()
    const width = 200, height = 120
    const pixels = Buffer.from(Array.from({ length: width * height * 3 }, (_, index) => index % 251))
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg().withMetadata({ orientation }).toBuffer()
    const oriented = await sharp(source).rotate().raw().toBuffer()
    const result = await cropImageSource({ source: dataUrl(source), aspectRatio: '3:4' })
    const decoded = await sharp(outputBytes(result)).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 120, height: 160 })
    expect(decoded.data.equals(regionPixels(oriented, 120, 0, 20, 120, 160))).toBe(true)
  })
})
